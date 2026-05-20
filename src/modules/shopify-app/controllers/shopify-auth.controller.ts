import {
  Controller,
  Get,
  Query,
  Res,
  Req,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Public } from '../../auth/decorators/public.decorator';
import { ShopifyAuthService } from '../services/shopify-auth.service';
import { ConnectorService } from '../../connectors/services/connector.service';
import { ShopifyConnector } from '../../connectors/services/shopify.connector';
import { OrganizationEntity } from '../../auth/entities/organization.entity';

const WEBHOOK_TOPICS = [
  'products/create',
  'products/update',
  'orders/create',
  'app/uninstalled',
];

@Public()
@Controller('shopify')
export class ShopifyAuthController {
  private readonly logger = new Logger(ShopifyAuthController.name);
  private readonly apiKey = process.env.SHOPIFY_API_KEY ?? '';
  private readonly webhookBaseUrl = process.env.API_BASE_URL ?? 'https://api.usahts.com';

  constructor(
    private readonly shopifyAuthService: ShopifyAuthService,
    private readonly connectorService: ConnectorService,
    private readonly shopifyConnector: ShopifyConnector,
    @InjectRepository(OrganizationEntity)
    private readonly organizationRepository: Repository<OrganizationEntity>,
  ) {}

  /**
   * Step 1: Merchant clicks install → redirect to Shopify OAuth consent screen
   * GET /shopify/auth?shop=mystore.myshopify.com
   */
  @Get('auth')
  async beginAuth(
    @Query('shop') shop: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!shop) {
      throw new HttpException('Missing shop parameter', HttpStatus.BAD_REQUEST);
    }

    const authUrl = await this.shopifyAuthService.buildAuthUrl(shop);
    this.logger.log(`OAuth started for shop: ${shop}`);
    res.redirect(authUrl);
  }

  /**
   * Step 2: Shopify redirects back with auth code after merchant approves
   * GET /shopify/auth/callback?code=...&shop=...&state=...&hmac=...
   */
  @Get('auth/callback')
  async handleCallback(
    @Query('code') code: string,
    @Query('shop') shop: string,
    @Query('state') state: string,
    @Query('hmac') hmac: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!code || !shop || !state || !hmac) {
      throw new HttpException('Missing required OAuth parameters', HttpStatus.BAD_REQUEST);
    }

    const queryString = (req.url.split('?')[1]) ?? '';

    const session = await this.shopifyAuthService.handleCallback(
      shop,
      code,
      state,
      hmac,
      queryString,
    );

    // If a connector already exists for this shop, reactivate it (handles reinstall).
    // Otherwise, the merchant must explicitly link an account via the embedded app's
    // "Connect HTS" view (no auto-organization creation).
    try {
      const existingConnector = await this.connectorService.findConnectorByShopDomain(shop);
      if (existingConnector) {
        await this.connectorService.updateConnector(
          existingConnector.id,
          existingConnector.organizationId,
          {
            isActive: true,
            config: { shopUrl: shop, accessToken: session.accessToken },
          },
        );
        session.connectorId = existingConnector.id;
        session.organizationId = existingConnector.organizationId;
        this.logger.log(`Reactivated connector ${existingConnector.id} for ${shop}`);
      } else {
        this.logger.log(
          `No prior connector for ${shop}; merchant will complete setup in embedded app.`,
        );
      }
    } catch (error) {
      this.logger.warn(`Connector lookup failed for ${shop}: ${error.message}`);
    }

    // Always persist session (including new access token)
    await this.shopifyAuthService.saveSession(session);

    // Register webhooks only for shops that are already linked to an HTS account.
    // For new installs (no connector yet), webhooks are registered after the merchant
    // completes the account link via POST /shopify/api/connect.
    // The app/uninstalled webhook is always registered so we can clean up if needed.
    if (session.connectorId && session.organizationId) {
      await this.registerWebhooks(shop, session.accessToken);
    } else {
      await this.registerUninstallWebhookOnly(shop, session.accessToken);
    }

    this.logger.log(`OAuth completed for shop: ${shop}`);

    // Redirect to the embedded app inside Shopify Admin
    res.redirect(`https://${shop}/admin/apps/${this.apiKey}`);
  }

  /**
   * Step 3: Serve the embedded app — fully self-contained inside Shopify Admin.
   * GET /shopify/app
   */
  @Get('app')
  async serveApp(
    @Query('shop') shop: string,
    @Query('host') host: string,
    @Res() res: Response,
  ): Promise<void> {
    const shopDomain = shop ? `https://${shop}` : 'https://*.myshopify.com';
    res.setHeader(
      'Content-Security-Policy',
      `frame-ancestors https://admin.shopify.com ${shopDomain}`,
    );

    res.setHeader('Content-Type', 'text/html');
    res.send(this.buildEmbeddedAppHtml());
  }

  /**
   * Register webhooks with Shopify after successful OAuth.
   * Uses GraphQL webhookSubscriptionCreate mutation.
   * Idempotent — "already exists" errors are swallowed.
   */
  async registerWebhooks(shop: string, accessToken: string): Promise<void> {
    const config = { shopUrl: shop, accessToken };
    const webhookUrl = `${this.webhookBaseUrl}/api/v1/webhooks/shopify`;

    for (const topic of WEBHOOK_TOPICS) {
      try {
        await this.shopifyConnector.createWebhook(config, webhookUrl, topic);
        this.logger.log(`Webhook registered: ${topic} → ${webhookUrl} for ${shop}`);
      } catch (error: any) {
        if (error.message?.includes('already exists') || error.message?.includes('has already been taken')) {
          this.logger.log(`Webhook already exists: ${topic} for ${shop}`);
        } else {
          this.logger.warn(`Failed to register webhook ${topic} for ${shop}: ${error.message}`);
        }
      }
    }
  }

  /**
   * Register only the app/uninstalled webhook — used for unlinked shops so we
   * can still detect uninstalls. Product/order webhooks are deferred until the
   * merchant completes account linking.
   */
  private async registerUninstallWebhookOnly(shop: string, accessToken: string): Promise<void> {
    const config = { shopUrl: shop, accessToken };
    const webhookUrl = `${this.webhookBaseUrl}/api/v1/webhooks/shopify`;
    try {
      await this.shopifyConnector.createWebhook(config, webhookUrl, 'app/uninstalled');
      this.logger.log(`app/uninstalled webhook registered for unlinked shop ${shop}`);
    } catch (error: any) {
      if (error.message?.includes('already exists') || error.message?.includes('has already been taken')) {
        this.logger.log(`app/uninstalled webhook already exists for ${shop}`);
      } else {
        this.logger.warn(`Failed to register app/uninstalled webhook for ${shop}: ${error.message}`);
      }
    }
  }

  private buildEmbeddedAppHtml(): string {
    const apiBase = this.webhookBaseUrl;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="shopify-api-key" content="${this.apiKey}">
  <title>HTS Duty Calculator</title>
  <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; padding: 20px; background: #f6f6f7; }
    .app { max-width: 900px; margin: 0 auto; }
    h1 { font-size: 22px; font-weight: 600; }
    .subtitle { color: #616161; font-size: 14px; margin-top: 4px; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .card { background: #fff; border: 1px solid #e1e3e5; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
    .card h2 { font-size: 15px; font-weight: 600; margin-bottom: 12px; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
    .badge--success { background: #aee9d1; color: #1a472a; }
    .badge--error { background: #fed3d1; color: #611a15; }
    .badge--pending { background: #ffea8a; color: #573b00; }
    .badge--info { background: #a4e8f2; color: #003135; }
    .btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 500; cursor: pointer; border: none; transition: background 0.15s; }
    .btn--primary { background: #008060; color: #fff; }
    .btn--primary:hover { background: #006e52; }
    .btn--primary:disabled { background: #8c9196; cursor: not-allowed; }
    .btn--outline { background: #fff; color: #1a1a1a; border: 1px solid #c9cccf; }
    .btn--outline:hover { background: #f6f6f7; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
    .stat { text-align: center; padding: 12px; }
    .stat-value { font-size: 28px; font-weight: 700; color: #1a1a1a; }
    .stat-label { font-size: 12px; color: #6d7175; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 8px 12px; color: #6d7175; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e1e3e5; }
    td { padding: 10px 12px; border-bottom: 1px solid #f1f2f3; }
    tr:last-child td { border-bottom: none; }
    .empty { text-align: center; padding: 40px; color: #8c9196; }
    .spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid #e1e3e5; border-top-color: #008060; border-radius: 50%; animation: spin 0.6s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .loading { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 40px; color: #6d7175; }
    .tab-bar { display: flex; gap: 0; border-bottom: 1px solid #e1e3e5; margin-bottom: 16px; }
    .tab { padding: 10px 16px; font-size: 14px; font-weight: 500; cursor: pointer; color: #6d7175; border-bottom: 2px solid transparent; transition: all 0.15s; background: none; border-top: none; border-left: none; border-right: none; }
    .tab:hover { color: #1a1a1a; }
    .tab--active { color: #1a1a1a; border-bottom-color: #008060; }
    .alert { padding: 12px 16px; border-radius: 8px; font-size: 13px; margin-bottom: 12px; }
    .alert--error { background: #fef1f1; border: 1px solid #fed3d1; color: #611a15; }
    .alert--success { background: #f1f8f5; border: 1px solid #aee9d1; color: #1a472a; }
    .product-row { display: flex; justify-content: space-between; align-items: center; }
    .product-title { font-weight: 500; }
    .product-meta { font-size: 12px; color: #6d7175; }
    .mono { font-family: 'SF Mono', Monaco, monospace; font-size: 12px; }
  </style>
</head>
<body>
  <div class="app">
    <div class="header">
      <div>
        <h1>HTS Duty Calculator</h1>
        <p class="subtitle">Automated product classification &amp; duty estimation</p>
      </div>
      <button class="btn btn--primary" id="syncBtn" onclick="triggerSync()" disabled>
        Sync Products
      </button>
    </div>

    <div id="alert"></div>
    <div id="content"><div class="loading"><span class="spinner"></span> Loading...</div></div>
  </div>

<script>
const API = '${apiBase}/shopify/api';
let sessionToken = null;
let currentTab = 'overview';

// App Bridge auto-initializes via the meta tag. Get session token from shopify global.
async function getToken() {
  if (window.shopify && window.shopify.idToken) {
    sessionToken = await window.shopify.idToken();
  }
  return sessionToken;
}

async function apiFetch(path, opts = {}) {
  const token = await getToken();
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token,
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || 'Request failed');
  }
  return res.json();
}

function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function showAlert(msg, type) {
  document.getElementById('alert').innerHTML = '<div class="alert alert--' + esc(type) + '">' + esc(msg) + '</div>';
  if (type === 'success') setTimeout(function() { document.getElementById('alert').innerHTML = ''; }, 5000);
}

function badge(status) {
  const map = { connected: 'success', error: 'error', pending: 'pending', disconnected: 'pending',
                completed: 'success', failed: 'error', started: 'pending', partial: 'info' };
  return '<span class="badge badge--' + (map[status] || 'pending') + '">' + status + '</span>';
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(ms) {
  if (!ms) return '—';
  return ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(1) + 's';
}

// ── Tabs ──
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('tab--active', t.dataset.tab === tab));
  if (tab === 'overview') loadStatus();
  else if (tab === 'products') loadProducts();
  else if (tab === 'history') loadStatus();
  else if (tab === 'settings') loadSettings();
}

// ── Overview ──
async function loadStatus() {
  try {
    const data = await apiFetch('/status');
    if (data.requiresSetup) {
      renderConnectView(data);
    } else {
      document.getElementById('syncBtn').disabled = false;
      renderDashboard(data);
    }
  } catch (e) {
    document.getElementById('content').innerHTML = '<div class="card"><div class="empty">Failed to load: ' + esc(e.message) + '</div></div>';
  }
}

// ── Connect View (shown when no account is linked) ──
function renderConnectView(data) {
  const shop = data.shop || '';
  const registerUrl = 'https://www.usahts.com/auth/register?from=shopify&shop=' + encodeURIComponent(shop);

  let html = '<div class="card">';
  html += '<h2>Connect HTS</h2>';
  html += '<p style="color:#6d7175;font-size:14px;margin-bottom:16px;">';
  html += 'Sign up for HTS to finish setting up your store. We&#39;ll walk you through the rest from your HTS dashboard.';
  html += '</p>';
  html += '<a class="btn btn--primary" href="' + esc(registerUrl) + '" target="_blank" rel="noopener">Sign up for HTS</a>';
  html += '</div>';

  html += '<div class="card">';
  html += '<h2>HTS store settings</h2>';
  html += '<p style="color:#6d7175;font-size:14px;margin-bottom:16px;">';
  html += 'Your API credentials will be accessible in your HTS Dashboard once your HTS account has been created. Once you save them below, your account will be connected.';
  html += '</p>';
  html += '<div style="margin-bottom:12px;">';
  html += '<label style="display:block;font-size:13px;font-weight:500;margin-bottom:4px;">Account number</label>';
  html += '<input type="text" id="acctNum" placeholder="c1f17791-9448-4461-b026-f16c69d156f4" style="width:100%;padding:8px 10px;border:1px solid #c9cccf;border-radius:6px;font-family:monospace;font-size:13px;">';
  html += '</div>';
  html += '<div style="margin-bottom:12px;">';
  html += '<label style="display:block;font-size:13px;font-weight:500;margin-bottom:4px;">Credential token</label>';
  html += '<input type="password" id="credToken" placeholder="hts_live_..." style="width:100%;padding:8px 10px;border:1px solid #c9cccf;border-radius:6px;font-family:monospace;font-size:13px;">';
  html += '</div>';
  html += '<button class="btn btn--primary" onclick="connectAccount()">Save and Connect</button>';
  html += '<div id="connectAlert" style="margin-top:12px;"></div>';
  html += '</div>';

  document.getElementById('content').innerHTML = html;
}

let connectInFlight = false;

async function connectAccount() {
  if (connectInFlight) return; // prevent double-click
  const btn = document.querySelector('#connectAlert')?.previousElementSibling;
  const acctNum = document.getElementById('acctNum').value.trim();
  const credToken = document.getElementById('credToken').value.trim();
  const alertEl = document.getElementById('connectAlert');
  if (!acctNum || !credToken) {
    alertEl.innerHTML = '<div class="alert alert--error">Please fill in both fields.</div>';
    return;
  }
  connectInFlight = true;
  if (btn) btn.setAttribute('disabled', 'disabled');
  alertEl.innerHTML = '<div class="alert alert--info">Connecting...</div>';
  try {
    const result = await apiFetch('/connect', {
      method: 'POST',
      body: JSON.stringify({ accountNumber: acctNum, credentialToken: credToken }),
    });
    alertEl.innerHTML = '<div class="alert alert--success">Connected to ' + esc(result.organizationName || 'HTS') + '. Loading dashboard...</div>';
    setTimeout(function() { loadStatus(); }, 1000);
  } catch (e) {
    alertEl.innerHTML = '<div class="alert alert--error">' + esc(e.message) + '</div>';
    connectInFlight = false;
    if (btn) btn.removeAttribute('disabled');
  }
}

function renderDashboard(data) {
  const c = data.connector || {};
  const s = data.stats || {};
  const logs = data.recentLogs || [];

  let html = '<div class="tab-bar">';
  html += '<button class="tab' + (currentTab === 'overview' ? ' tab--active' : '') + '" data-tab="overview" onclick="switchTab(&#39;overview&#39;)">Overview</button>';
  html += '<button class="tab' + (currentTab === 'products' ? ' tab--active' : '') + '" data-tab="products" onclick="switchTab(&#39;products&#39;)">Products</button>';
  html += '<button class="tab' + (currentTab === 'history' ? ' tab--active' : '') + '" data-tab="history" onclick="switchTab(&#39;history&#39;)">Sync History</button>';
  html += '<button class="tab' + (currentTab === 'settings' ? ' tab--active' : '') + '" data-tab="settings" onclick="switchTab(&#39;settings&#39;)">Settings</button>';
  html += '</div>';

  if (currentTab === 'overview') {
    html += '<div class="card"><h2>Connection Status</h2>';
    html += '<p>Store: <strong>' + (data.shop || '—') + '</strong> &nbsp; ' + badge(c.status || 'connected') + '</p>';
    if (c.lastSyncAt) html += '<p style="margin-top:8px;font-size:13px;color:#6d7175;">Last sync: ' + fmtDate(c.lastSyncAt) + '</p>';
    if (c.lastError) html += '<p style="margin-top:4px;font-size:13px;color:#d72c0d;">' + c.lastError + '</p>';
    html += '</div>';

    html += '<div class="card"><h2>Statistics</h2><div class="stats">';
    html += '<div class="stat"><div class="stat-value">' + (s.totalSyncs || 0) + '</div><div class="stat-label">Total Syncs</div></div>';
    html += '<div class="stat"><div class="stat-value">' + (s.successfulSyncs || 0) + '</div><div class="stat-label">Successful</div></div>';
    html += '<div class="stat"><div class="stat-value">' + (s.totalItemsProcessed || 0) + '</div><div class="stat-label">Items Processed</div></div>';
    html += '<div class="stat"><div class="stat-value">' + fmtDuration(s.averageDuration) + '</div><div class="stat-label">Avg Duration</div></div>';
    html += '</div></div>';
  }

  if (currentTab === 'history') {
    html += '<div class="card"><h2>Recent Syncs</h2>';
    if (logs.length === 0) {
      html += '<div class="empty">No syncs yet. Click "Sync Products" to start.</div>';
    } else {
      html += '<table><thead><tr><th>Type</th><th>Status</th><th>Items</th><th>Duration</th><th>Date</th></tr></thead><tbody>';
      logs.forEach(function(log) {
        html += '<tr><td>' + log.syncType + '</td><td>' + badge(log.status) + '</td>';
        html += '<td>' + log.itemsSucceeded + '/' + log.itemsProcessed + '</td>';
        html += '<td>' + fmtDuration(log.durationMs) + '</td>';
        html += '<td>' + fmtDate(log.startedAt) + '</td></tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';
  }

  document.getElementById('content').innerHTML = html;
}

// ── Products ──
async function loadProducts() {
  document.getElementById('content').innerHTML = '<div class="tab-bar">' +
    '<button class="tab" data-tab="overview" onclick="switchTab(&#39;overview&#39;)">Overview</button>' +
    '<button class="tab tab--active" data-tab="products" onclick="switchTab(&#39;products&#39;)">Products</button>' +
    '<button class="tab" data-tab="history" onclick="switchTab(&#39;history&#39;)">Sync History</button>' +
    '<button class="tab" data-tab="settings" onclick="switchTab(&#39;settings&#39;)">Settings</button>' +
    '</div><div class="loading"><span class="spinner"></span> Loading products...</div>';
  try {
    const data = await apiFetch('/products');
    renderProducts(data);
  } catch (e) {
    document.getElementById('content').innerHTML += '<div class="card"><div class="empty">Failed to load products: ' + esc(e.message) + '</div></div>';
  }
}

function renderProducts(data) {
  let html = '<div class="tab-bar">';
  html += '<button class="tab" data-tab="overview" onclick="switchTab(&#39;overview&#39;)">Overview</button>';
  html += '<button class="tab tab--active" data-tab="products" onclick="switchTab(&#39;products&#39;)">Products</button>';
  html += '<button class="tab" data-tab="history" onclick="switchTab(&#39;history&#39;)">Sync History</button>';
  html += '<button class="tab" data-tab="settings" onclick="switchTab(&#39;settings&#39;)">Settings</button>';
  html += '</div>';

  html += '<div class="card"><h2>Products (' + data.total + ')</h2>';
  if (data.products.length === 0) {
    html += '<div class="empty">No products found.</div>';
  } else {
    html += '<table><thead><tr><th>Product</th><th>SKU</th><th>HS Code</th><th>Country</th></tr></thead><tbody>';
    data.products.forEach(function(p) {
      p.variants.forEach(function(v) {
        html += '<tr><td class="product-title">' + esc(p.title) + '</td>';
        html += '<td class="mono">' + (v.sku ? esc(v.sku) : '<span style="color:#8c9196">—</span>') + '</td>';
        html += '<td class="mono">' + (v.hsCode ? '<span style="color:#008060;font-weight:500">' + esc(v.hsCode) + '</span>' : '<span style="color:#8c9196">—</span>') + '</td>';
        html += '<td>' + (v.countryOfOrigin ? esc(v.countryOfOrigin) : '—') + '</td></tr>';
      });
    });
    html += '</tbody></table>';
  }
  html += '</div>';
  document.getElementById('content').innerHTML = html;
}

// ── Settings ──
async function loadSettings() {
  let html = '<div class="tab-bar">';
  html += '<button class="tab" data-tab="overview" onclick="switchTab(&#39;overview&#39;)">Overview</button>';
  html += '<button class="tab" data-tab="products" onclick="switchTab(&#39;products&#39;)">Products</button>';
  html += '<button class="tab" data-tab="history" onclick="switchTab(&#39;history&#39;)">Sync History</button>';
  html += '<button class="tab tab--active" data-tab="settings" onclick="switchTab(&#39;settings&#39;)">Settings</button>';
  html += '</div><div class="loading"><span class="spinner"></span> Loading settings...</div>';
  document.getElementById('content').innerHTML = html;

  try {
    const data = await apiFetch('/settings');
    renderSettings({
      calculateDuty: data.calculateDuty !== false,
      displayAtCheckout: data.displayAtCheckout !== false,
    });
  } catch (e) {
    document.getElementById('content').innerHTML += '<div class="card"><div class="empty">Failed to load settings: ' + esc(e.message) + '</div></div>';
  }
}

function renderSettings(current) {
  let html = '<div class="tab-bar">';
  html += '<button class="tab" data-tab="overview" onclick="switchTab(&#39;overview&#39;)">Overview</button>';
  html += '<button class="tab" data-tab="products" onclick="switchTab(&#39;products&#39;)">Products</button>';
  html += '<button class="tab" data-tab="history" onclick="switchTab(&#39;history&#39;)">Sync History</button>';
  html += '<button class="tab tab--active" data-tab="settings" onclick="switchTab(&#39;settings&#39;)">Settings</button>';
  html += '</div>';

  html += '<div class="card"><h2>Duty &amp; tax calculation</h2>';
  html += '<p style="color:#6d7175;font-size:14px;margin-bottom:16px;">Control whether HTS Classify runs duty/tax calculations on this store\\'s orders, and whether the result is shown to buyers at checkout.</p>';

  const calcChecked = current.calculateDuty ? 'checked' : '';
  const displayChecked = current.displayAtCheckout ? 'checked' : '';
  const displayDisabled = current.calculateDuty ? '' : 'disabled';

  html += '<label style="display:flex;gap:12px;padding:14px;border:1px solid #c9cccf;border-radius:8px;margin-bottom:10px;cursor:pointer;">';
  html += '<input type="checkbox" id="calcChk" ' + calcChecked + ' onchange="onSettingsChanged()" style="margin-top:2px;">';
  html += '<div><div style="font-weight:600;margin-bottom:4px;">Calculate duty &amp; tax</div>';
  html += '<div style="font-size:13px;color:#6d7175;">When enabled, HTS Classify will compute estimated US import duties and taxes for each order on this store. Each calculation is a billable API call.</div></div>';
  html += '</label>';

  html += '<label style="display:flex;gap:12px;padding:14px;border:1px solid #c9cccf;border-radius:8px;margin-bottom:10px;cursor:' + (displayDisabled ? 'not-allowed' : 'pointer') + ';' + (displayDisabled ? 'opacity:0.55;' : '') + '">';
  html += '<input type="checkbox" id="displayChk" ' + displayChecked + ' ' + displayDisabled + ' onchange="onSettingsChanged()" style="margin-top:2px;">';
  html += '<div><div style="font-weight:600;margin-bottom:4px;">Display duty &amp; tax at checkout</div>';
  html += '<div style="font-size:13px;color:#6d7175;">When enabled, buyers see the calculated duty / tax estimate in the checkout banner. Requires the calculation checkbox above to be on.</div></div>';
  html += '</label>';

  html += '<div id="settingsAlert" style="margin-top:12px;"></div></div>';
  document.getElementById('content').innerHTML = html;
}

function onSettingsChanged() {
  const calculateDuty = document.getElementById('calcChk').checked;
  const displayEl = document.getElementById('displayChk');
  // Force display off when calc is off; disable the input visually too.
  if (!calculateDuty) {
    displayEl.checked = false;
    displayEl.disabled = true;
  } else {
    displayEl.disabled = false;
  }
  saveSettings(calculateDuty, displayEl.checked);
}

async function saveSettings(calculateDuty, displayAtCheckout) {
  const alertEl = document.getElementById('settingsAlert');
  alertEl.innerHTML = '<div class="alert alert--info">Saving...</div>';
  try {
    const updated = await apiFetch('/settings', {
      method: 'PATCH',
      body: JSON.stringify({ calculateDuty: calculateDuty, displayAtCheckout: displayAtCheckout }),
    });
    alertEl.innerHTML = '<div class="alert alert--success">Settings saved.</div>';
    setTimeout(function() {
      renderSettings({
        calculateDuty: updated.calculateDuty !== false,
        displayAtCheckout: updated.displayAtCheckout !== false,
      });
    }, 600);
  } catch (e) {
    alertEl.innerHTML = '<div class="alert alert--error">Failed to save: ' + esc(e.message) + '</div>';
  }
}

// ── Sync ──
async function triggerSync() {
  const btn = document.getElementById('syncBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Syncing...';
  showAlert('Product sync started. This may take a minute...', 'success');
  try {
    const result = await apiFetch('/sync', { method: 'POST' });
    showAlert('Sync complete: ' + result.syncLog.itemsSucceeded + '/' + result.syncLog.itemsProcessed + ' items classified.', 'success');
  } catch (e) {
    showAlert('Sync failed: ' + e.message, 'error');
  }
  btn.disabled = false;
  btn.innerHTML = 'Sync Products';
  loadStatus();
}

// ── Init ──
setTimeout(function() { loadStatus(); }, 500);
</script>
</body>
</html>`;
  }
}
