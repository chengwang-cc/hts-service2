#!/usr/bin/env ts-node
/**
 * HTS Service CLI - Local Testing & Processing
 *
 * Usage:
 *   npm run cli:import-hts <url> <version>
 *   npm run cli:process-pdf <path-or-url> <year> <chapter>
 *   npm run cli:job-status <jobId>
 *   npm run cli:list-imports
 */

import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { HtsImportService } from '../src/modules/admin/services/hts-import.service';
import { KnowledgeAdminService } from '../src/modules/admin/services/knowledge.admin.service';
import { QueueService } from '../src/modules/queue/queue.service';
import { UsitcDownloaderService } from '../packages/core/src/services/usitc-downloader.service';
import { createReadStream, existsSync } from 'fs';
import { basename } from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });

  const command = process.argv[2];
  const args = process.argv.slice(3);

  try {
    switch (command) {
      case 'download-latest':
        await downloadLatest(app);
        break;
      case 'import-hts':
        await importHts(app, args);
        break;
      case 'process-pdf':
        await processPdf(app, args);
        break;
      case 'job-status':
        await checkJobStatus(app, args);
        break;
      case 'list-imports':
        await listImports(app, args);
        break;
      case 'list-documents':
        await listDocuments(app, args);
        break;
      case 'help':
      default:
        showHelp();
        break;
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await app.close();
  }
}

/**
 * Download and import latest HTS data (JSON + PDF)
 * Automatically finds the latest available revision
 */
async function downloadLatest(app: any) {
  console.log('🔍 Finding latest HTS revision...');
  console.log('');

  const usitcDownloader = app.get(UsitcDownloaderService);
  const latest = await usitcDownloader.findLatestRevision();

  if (!latest) {
    console.error('❌ Could not find any available HTS data');
    process.exit(1);
  }

  console.log('✅ Found latest revision:');
  console.log(`   Year: ${latest.year}`);
  console.log(`   Revision: ${latest.revision}`);
  console.log(`   JSON: ${latest.jsonUrl}`);
  console.log(`   PDF: ${latest.pdfUrl}`);
  console.log('');

  const version = `${latest.year}-revision-${latest.revision}`;

  // Import JSON (HTS codes)
  console.log('📥 Step 1/2: Importing HTS codes (JSON)...');
  const htsImportService = app.get(HtsImportService);

  const importResult = await htsImportService.createImport(
    {
      year: latest.year,
      revision: latest.revision,
    },
    'CLI_USER'
  );

  console.log('   ✅ JSON import started');
  console.log(`   Import ID: ${importResult.id}`);
  console.log(`   Job ID: ${importResult.jobId}`);
  console.log('');

  // Import PDF (Knowledge library)
  console.log('📄 Step 2/2: Importing HTS PDF (knowledge library)...');
  const knowledgeService = app.get(KnowledgeAdminService);

  const pdfResult = await knowledgeService.uploadDocument(
    {
      year: latest.year,
      revision: latest.revision,
      chapter: '00',
    }
  );

  console.log('   ✅ PDF import started');
  console.log(`   Document ID: ${pdfResult.id}`);
  console.log(`   Job ID: ${pdfResult.jobId}`);
  console.log('');

  console.log('═══════════════════════════════════════════════════════════');
  console.log('✨ Latest HTS data import initiated successfully!');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('📊 Monitor progress:');
  console.log(`   JSON: npm run cli:job-status ${importResult.jobId}`);
  console.log(`   PDF:  npm run cli:job-status ${pdfResult.jobId}`);
  console.log('');
  console.log('📋 View imports:');
  console.log('   npm run cli:list-imports');
  console.log('   npm run cli:list-documents');
}

/**
 * Import HTS data from URL
 */
async function importHts(app: any, args: string[]) {
  const [url, version] = args;

  if (!url || !version) {
    console.error('Usage: npm run cli:import-hts <url> <version>');
    console.error('Example: npm run cli:import-hts https://hts.usitc.gov/data/2025.json 2025-revision-1');
    process.exit(1);
  }

  console.log('🚀 Starting HTS Import...');
  console.log(`   URL: ${url}`);
  console.log(`   Version: ${version}`);
  console.log('');

  const htsImportService = app.get(HtsImportService);

  const result = await htsImportService.createImport(
    {
      sourceUrl: url,
      sourceVersion: version,
    },
    'CLI_USER'
  );

  console.log('✅ Import job created successfully!');
  console.log(`   Import ID: ${result.id}`);
  console.log(`   Job ID: ${result.jobId}`);
  console.log(`   Status: ${result.status}`);
  console.log('');
  console.log('Monitor progress with:');
  console.log(`   npm run cli:job-status ${result.jobId}`);
  console.log('');
  console.log('Or check database:');
  console.log(`   SELECT * FROM hts_import_history WHERE id = '${result.id}';`);
}

/**
 * Process PDF document
 */
async function processPdf(app: any, args: string[]) {
  const [pathOrUrl, year, chapter] = args;

  if (!pathOrUrl || !year || !chapter) {
    console.error('Usage: npm run cli:process-pdf <path-or-url> <year> <chapter>');
    console.error('Example: npm run cli:process-pdf /path/to/chapter99.pdf 2025 99');
    console.error('Example: npm run cli:process-pdf https://example.com/ch99.pdf 2025 99');
    process.exit(1);
  }

  console.log('📄 Starting PDF Processing...');
  console.log(`   Source: ${pathOrUrl}`);
  console.log(`   Year: ${year}`);
  console.log(`   Chapter: ${chapter}`);
  console.log('');

  const knowledgeService = app.get(KnowledgeAdminService);

  // Determine if it's a URL or local file
  const isUrl = pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://');

  let documentData: any;

  if (isUrl) {
    // URL-based document
    documentData = {
      year: parseInt(year),
      chapter: chapter.padStart(2, '0'),
      type: 'PDF',
      url: pathOrUrl,
      title: `Chapter ${chapter} - ${year}`,
    };
  } else {
    // Local file upload
    if (!existsSync(pathOrUrl)) {
      console.error(`❌ File not found: ${pathOrUrl}`);
      process.exit(1);
    }

    const fileBuffer = await import('fs/promises').then(fs => fs.readFile(pathOrUrl));
    const fileName = basename(pathOrUrl);

    documentData = {
      year: parseInt(year),
      chapter: chapter.padStart(2, '0'),
      type: 'PDF',
      file: {
        buffer: fileBuffer,
        originalname: fileName,
        mimetype: 'application/pdf',
        size: fileBuffer.length,
      },
      title: `Chapter ${chapter} - ${year}`,
    };
  }

  const result = await knowledgeService.uploadDocument(documentData);

  console.log('✅ Document processing job created successfully!');
  console.log(`   Document ID: ${result.id}`);
  console.log(`   Job ID: ${result.jobId}`);
  console.log(`   Status: ${result.status}`);
  console.log(`   File Size: ${(result.fileSize || 0 / 1024 / 1024).toFixed(2)} MB`);
  console.log('');
  console.log('Monitor progress with:');
  console.log(`   npm run cli:job-status ${result.jobId}`);
  console.log('');
  console.log('Or check database:');
  console.log(`   SELECT * FROM hts_documents WHERE id = '${result.id}';`);
}

/**
 * Check job status
 */
async function checkJobStatus(app: any, args: string[]) {
  const [jobId] = args;

  if (!jobId) {
    console.error('Usage: npm run cli:job-status <jobId>');
    process.exit(1);
  }

  console.log(`🔍 Checking job status: ${jobId}`);
  console.log('');

  // Query pg-boss directly
  const dataSource = app.get('DataSource');

  const job = await dataSource.query(
    `SELECT * FROM pgboss.job WHERE id = $1`,
    [jobId]
  );

  if (job.length === 0) {
    console.log('❌ Job not found');
    return;
  }

  const jobData = job[0];

  console.log('Job Details:');
  console.log(`   ID: ${jobData.id}`);
  console.log(`   Name: ${jobData.name}`);
  console.log(`   State: ${jobData.state}`);
  console.log(`   Priority: ${jobData.priority}`);
  console.log(`   Retry Limit: ${jobData.retrylimit}`);
  console.log(`   Retry Count: ${jobData.retrycount}`);
  console.log(`   Created: ${jobData.createdon}`);
  console.log(`   Started: ${jobData.startedon || 'Not started'}`);
  console.log(`   Completed: ${jobData.completedon || 'Not completed'}`);
  console.log('');

  if (jobData.output) {
    console.log('Output:', JSON.stringify(jobData.output, null, 2));
  }

  if (jobData.state === 'failed' && jobData.output) {
    console.log('');
    console.log('❌ Job failed with error:');
    console.log(JSON.stringify(jobData.output, null, 2));
  }

  // Try to find related import or document
  if (jobData.name === 'hts-import' && jobData.data) {
    const importId = jobData.data.importId;
    const importRecord = await dataSource.query(
      `SELECT id, source_version, status, checkpoint, s3_key FROM hts_import_history WHERE id = $1`,
      [importId]
    );

    if (importRecord.length > 0) {
      console.log('');
      console.log('Related HTS Import:');
      console.log(`   Import ID: ${importRecord[0].id}`);
      console.log(`   Version: ${importRecord[0].source_version}`);
      console.log(`   Status: ${importRecord[0].status}`);
      console.log(`   S3 Key: ${importRecord[0].s3_key || 'Not uploaded'}`);
      if (importRecord[0].checkpoint) {
        console.log(`   Checkpoint: ${JSON.stringify(importRecord[0].checkpoint, null, 2)}`);
      }
    }
  } else if (jobData.name === 'document-processing' && jobData.data) {
    const documentId = jobData.data.documentId;
    const docRecord = await dataSource.query(
      `SELECT id, year, chapter, status, checkpoint, s3_key, file_size FROM hts_documents WHERE id = $1`,
      [documentId]
    );

    if (docRecord.length > 0) {
      console.log('');
      console.log('Related Document:');
      console.log(`   Document ID: ${docRecord[0].id}`);
      console.log(`   Year/Chapter: ${docRecord[0].year}/${docRecord[0].chapter}`);
      console.log(`   Status: ${docRecord[0].status}`);
      console.log(`   S3 Key: ${docRecord[0].s3_key || 'Not uploaded'}`);
      console.log(`   File Size: ${(docRecord[0].file_size / 1024 / 1024).toFixed(2)} MB`);
      if (docRecord[0].checkpoint) {
        console.log(`   Checkpoint: ${JSON.stringify(docRecord[0].checkpoint, null, 2)}`);
      }
    }
  }
}

/**
 * List recent imports
 */
async function listImports(app: any, args: string[]) {
  const limit = parseInt(args[0] || '10');

  console.log(`📋 Recent HTS Imports (last ${limit}):`);
  console.log('');

  const htsImportService = app.get(HtsImportService);

  const result = await htsImportService.findAll({
    page: 1,
    pageSize: limit,
  });

  if (result.data.length === 0) {
    console.log('No imports found.');
    return;
  }

  console.table(
    result.data.map(imp => ({
      ID: imp.id.substring(0, 8),
      Version: imp.sourceVersion,
      Status: imp.status,
      'Started At': imp.importStartedAt?.toISOString().substring(0, 19) || 'N/A',
      'Duration (s)': imp.durationSeconds || 'N/A',
      'Total Entries': imp.totalEntries,
      'Imported': imp.importedEntries,
      'Failed': imp.failedEntries,
    }))
  );

  console.log('');
  console.log(`Total: ${result.total} imports`);
}

/**
 * List recent documents
 */
async function listDocuments(app: any, args: string[]) {
  const limit = parseInt(args[0] || '10');

  console.log(`📚 Recent Documents (last ${limit}):`);
  console.log('');

  const knowledgeService = app.get(KnowledgeAdminService);

  const result = await knowledgeService.findAll({
    page: 1,
    pageSize: limit,
  });

  if (result.data.length === 0) {
    console.log('No documents found.');
    return;
  }

  console.table(
    result.data.map(doc => ({
      ID: doc.id.substring(0, 8),
      'Year/Ch': `${doc.year}/${doc.chapter}`,
      Type: doc.documentType,
      Status: doc.status,
      'Size (MB)': doc.fileSize ? (doc.fileSize / 1024 / 1024).toFixed(2) : 'N/A',
      'S3': doc.s3Key ? '✓' : '✗',
      Parsed: doc.isParsed ? '✓' : '✗',
    }))
  );

  console.log('');
  console.log(`Total: ${result.total} documents`);
}

/**
 * Show help
 */
function showHelp() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                    HTS Service CLI Tool                           ║
╚═══════════════════════════════════════════════════════════════════╝

⚡ Quick Start (Recommended):
  npm run cli:download-latest
    🎯 Automatically find and import the latest HTS data
    • Auto-detects latest available revision (2026 Rev 3 as of Feb 2026)
    • Imports JSON (HTS codes → database)
    • Imports PDF (full document → knowledge library)
    • No manual URL lookup needed!

📥 Manual HTS Import Commands:
  npm run cli:import-hts <url> <version>
    Import HTS data from specific URL
    Example: npm run cli:import-hts https://hts.usitc.gov/data.json 2025-rev-1

📄 Manual PDF Processing Commands:
  npm run cli:process-pdf <path-or-url> <year> <chapter>
    Process a specific PDF document
    Example: npm run cli:process-pdf /tmp/ch99.pdf 2025 99
    Example: npm run cli:process-pdf https://example.com/ch99.pdf 2025 99

🔍 Status & Monitoring Commands:
  npm run cli:job-status <jobId>
    Check status of a specific job
    Example: npm run cli:job-status abc123-def456-...

  npm run cli:list-imports [limit]
    List recent HTS imports (default: 10)
    Example: npm run cli:list-imports 20

  npm run cli:list-documents [limit]
    List recent documents (default: 10)
    Example: npm run cli:list-documents 20

💡 Tips:
  - Use download-latest for the simplest workflow
  - All jobs run asynchronously through pg-boss
  - Use job-status to monitor progress
  - Check S3 bucket for uploaded files

📚 Documentation:
  See: htc-docs/2026-02-13/2025_usitc-download-urls.md
  `);
}

bootstrap().catch(console.error);
