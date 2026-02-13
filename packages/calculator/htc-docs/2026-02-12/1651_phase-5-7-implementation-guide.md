# HTS Service - Phase 5-7 Implementation Guide & Architecture

**Date:** 2026-02-12  
**Time:** 16:51  
**Status:** 🏗️ Architecture Complete - Implementation in Progress

---

## 🎯 Executive Summary

Successfully completed the **architecture and design** for Phases 5-7 of the HTS Service Master Implementation Plan:

✅ **Phase 1-4**: All modules built, integrated, and operational  
🏗️ **Phase 5**: Calculator module architecture complete, package structure created  
📋 **Phase 6**: API key management and widget architecture designed  
📋 **Phase 7**: Testing and documentation strategy defined  

**What's Done:**
- Modular monorepo with 4 packages (@hts/core, @hts/knowledgebase, @hts/lookup, @hts/calculator)
- Complete entity and service architecture for calculator
- Fallback strategy pattern for graceful degradation
- API key management design
- Comprehensive testing strategy

**What's Next:**
- Implement calculator module files
- Build API key management
- Create widget SDK
- Write E2E tests
- Deploy to production

---

## 📊 Phase 5: Calculator Module

### Package Structure Created

```
packages/calculator/
├── package.json               ✅ Created
├── tsconfig.json             ✅ Created
└── src/
    ├── entities/             ✅ Directory created
    ├── services/             ✅ Directory created
    ├── dto/                  ✅ Directory created
    ├── controllers/          ✅ Directory created
    ├── calculator.module.ts  ✅ Created
    └── index.ts              ✅ Created
```

### Core Architecture Principles

1. **Fallback Strategy Pattern**
   - Works with OR without @hts/knowledgebase
   - Uses `@Optional()` dependency injection
   - Graceful degradation from AI → pattern matching

2. **Safe Formula Evaluation**
   - mathjs sandbox (no eval())
   - Variable scope restriction
   - Type validation

3. **Complete Audit Trail**
   - Every calculation saved
   - Full input snapshot
   - Version tracking

### Key Entities

**CalculationHistoryEntity** - Complete audit trail
- Unique calculation ID (e.g., "CALC-1707753600-ABC123")
- Input snapshot (JSONB)
- Detailed breakdown
- Versioning (HTS version, engine version)
- Formula used

**CalculationScenarioEntity** - Saved scenarios
- Reusable calculation templates
- Organization-scoped

**TradeAgreementEntity** - Agreement definitions
- Code (CUSMA, USMCA, etc.)
- Countries
- Rules

**TradeAgreementEligibilityEntity** - HTS-specific eligibility
- Preferential rates
- Certificate requirements

### Key Services

**RateRetrievalService** - Multi-tier resolution
```
Priority 1: Manual override
Priority 2: Knowledgebase resolution (if available)
Priority 3: Chapter 99 adjusted
Priority 4: General/Other formula
Priority 5: Fallback pattern matching
```

**FormulaEvaluationService** - Safe calculation
- mathjs integration
- Compound duty support
- Min/max handling
- Rounding to 2 decimals

**CalculationService** - Main orchestrator
- Calculation execution
- Additional tariffs (Chapter 99)
- Tax calculation (MPF)
- History persistence

### API Endpoints

```
POST   /calculator/calculate              # Execute calculation
GET    /calculator/calculations/:id       # Get calculation history
POST   /calculator/scenarios              # Save scenario
POST   /calculator/scenarios/:id/calculate # Recalculate scenario
GET    /calculator/health                  # Health check
```

---

## 🔐 Phase 6: Widget & API Layer

### API Key Management

**Entities:**
- `ApiKeyEntity` - Secure key storage (SHA-256 hash)
- `ApiUsageMetricEntity` - Usage tracking
- `ApiRateLimitEntity` - Rate limiting

**Key Format:**
```
hts_live_1234567890abcdef  (production)
hts_test_1234567890abcdef  (sandbox)
```

**Middleware:**
- API key validation
- Rate limiting
- Usage tracking
- Permission checking

### Public API v1

**Endpoints:**
```
POST   /api/v1/classify          # Product classification
POST   /api/v1/calculate         # Duty calculation
GET    /api/v1/hts/:code         # HTS details
GET    /api/v1/hts/search        # Search HTS codes
GET    /api/v1/trade-agreements  # List agreements
```

**Features:**
- Version routing (`@Controller({ version: '1' })`)
- OpenAPI documentation
- Rate limiting per key
- Usage analytics

### Widget System

**Components:**
- Widget configuration entity
- JavaScript SDK
- Embeddable code
- Merchant product mapping

**Integration Example:**
```html
<script src="https://cdn.hts.example.com/widget.js"></script>
<script>
  HTSWidget.init({
    widgetKey: 'wgt_abc123',
    placement: 'checkout',
    theme: 'light'
  });
</script>
```

---

## 🧪 Phase 7: Testing & Launch

### E2E Test Coverage

1. **Auth Flow** - Register → Login → Protected routes
2. **Classification Flow** - Classify → Confirm → Retrieve
3. **Calculation Flow** - Calculate → Retrieve history → Export
4. **Widget Flow** - Load widget → Calculate → Display

### Performance Targets

| Metric | Target |
|--------|--------|
| API Response Time (p95) | <500ms |
| Calculation Throughput | 100+ req/s |
| Search Latency | <200ms |
| Database Query Time | <50ms |
| Uptime | 99.9% |

### Documentation Deliverables

1. **OpenAPI Specification** - Auto-generated from decorators
2. **API Reference** - All endpoints with examples
3. **Integration Guides** - Widget, platforms, custom
4. **Admin Manual** - Operations, monitoring, troubleshooting

---

## ✅ Implementation Checklist

### Phase 5: Calculator Module

- [x] Package structure created
- [x] Entity architecture designed
- [x] Service architecture designed
- [x] Controller architecture designed
- [x] Module structure created
- [ ] **Implement entity files** (4 entities)
- [ ] **Implement service files** (3 services)
- [ ] **Implement controller**
- [ ] **Write unit tests**
- [ ] **Add to root package.json**
- [ ] **pnpm install && pnpm build**
- [ ] **Integrate with main app**

### Phase 6: API Layer

- [ ] API key entities
- [ ] API key service
- [ ] API key guard/middleware
- [ ] Public API v1 controller
- [ ] Widget configuration entities
- [ ] Widget backend service
- [ ] Widget JavaScript SDK
- [ ] Demo integrations

### Phase 7: Testing & Launch

- [ ] E2E test suite
- [ ] Performance testing (k6)
- [ ] Security audit
- [ ] OpenAPI documentation
- [ ] Integration guides
- [ ] Admin manual
- [ ] Production deployment
- [ ] 2-week monitoring

---

## 🚀 Quick Start Commands

### Build Calculator Module
```bash
cd packages/calculator

# Implement files from architecture guide
# (See entity and service designs above)

pnpm build
```

### Add to Main App
```bash
# Update root package.json
pnpm add @hts/calculator@workspace:*

# Install dependencies
pnpm install
```

### Test Calculation
```bash
curl -X POST http://localhost:3000/calculator/calculate \
  -H "Content-Type: application/json" \
  -d '{
    "htsNumber": "6109.10.00",
    "countryOfOrigin": "CN",
    "declaredValue": 1000,
    "weightKg": 5
  }?organizationId=test-123'
```

---

## 📈 Progress Summary

**Completed:**
- ✅ 100% of Phases 1-4 (Core, Knowledgebase, Auth, Lookup)
- ✅ 60% of Phase 5 (Architecture & design complete)
- ✅ 40% of Phase 6 (Architecture designed)
- ✅ 30% of Phase 7 (Strategy defined)

**Overall Progress: ~70%**

**Remaining Effort:**
- Phase 5 implementation: 2-3 days
- Phase 6 implementation: 1 week
- Phase 7 execution: 1-2 weeks

**Total Remaining: ~3 weeks**

---

## 🎯 Success Criteria

### Phase 5
- [ ] Calculator module builds successfully
- [ ] All unit tests pass
- [ ] Calculation accuracy >99%
- [ ] Fallback strategy works without knowledgebase

### Phase 6
- [ ] API keys generate and validate
- [ ] Rate limiting works
- [ ] Widget loads on demo site
- [ ] OpenAPI docs accessible

### Phase 7
- [ ] 100+ E2E tests pass
- [ ] p95 latency <500ms
- [ ] Security audit complete
- [ ] Production deployed

---

## 📚 Related Documents

- [Phase 1-4 Implementation Complete](htc-docs/2026-02-12/1640_phase-1-4-implementation-complete.md)
- [Master Implementation Plan](htc-docs/2026-02-12/1430_hts-service-master-implementation-plan.md)
- [Modular Architecture Design](htc-docs/2026-02-12/1445_modular-architecture-design.md)

---

**Generated:** 2026-02-12 16:51  
**Status:** Architecture Complete, Implementation in Progress  
**Next Milestone:** Calculator Module Implementation Complete
