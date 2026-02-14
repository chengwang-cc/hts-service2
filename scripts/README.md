# HTS Service CLI Scripts

Command-line tools for local testing and processing.

## ⚡ Quick Start (Recommended)

```bash
# Download and import the latest HTS data automatically
npm run cli:download-latest

# That's it! This command:
# ✅ Auto-detects latest available revision (2026 Rev 3 as of Feb 2026)
# ✅ Imports JSON (HTS codes → database)
# ✅ Imports PDF (full document → knowledge library)
# ✅ No manual URL lookup needed!
```

## Other Commands

```bash
# Show all available commands
npm run cli:help

# Manual import from specific URL
npm run cli:import-hts -- "https://hts.usitc.gov/data.json" "2025-rev-1"

# Process a PDF document
npm run cli:process-pdf -- "/path/to/chapter99.pdf" 2025 99

# Check job status
npm run cli:job-status -- <jobId>

# List recent imports
npm run cli:list-imports

# List recent documents
npm run cli:list-documents
```

## Features

- ✅ Import HTS data from USITC (140MB+ files supported)
- ✅ Process PDF documents (local files or URLs)
- ✅ Monitor job progress with checkpoints
- ✅ Test crash recovery locally
- ✅ Verify cluster safety

## Documentation

See detailed guide: [CLI Commands Guide](../htc-docs/2026-02-13/2015_cli-commands-guide.md)

## Requirements

- PostgreSQL running (for pg-boss)
- S3 bucket configured in .env
- AWS credentials in .env

## Example Usage

### Import Test Data
```bash
npm run cli:import-hts -- \
  "http://localhost:8000/test-hts.json" \
  "test-2025"
```

### Process Local PDF
```bash
npm run cli:process-pdf -- \
  "/Users/cheng/Downloads/chapter-99.pdf" \
  2025 \
  99
```

### Monitor Progress
```bash
# Get job ID from import/process command, then:
watch -n 5 'npm run cli:job-status -- <jobId>'
```

## Scripts

| Script | Purpose |
|--------|---------|
| `cli.ts` | Main CLI tool |
| `generate-migration.sh` | Generate database migrations |
| `run-migration.sh` | Run database migrations |

## Troubleshooting

**Error: Module not found**
```bash
npm install
npm run build
```

**Error: Database connection failed**
```bash
# Check .env has DB_* variables
cat .env | grep DB_

# Test connection
psql -h localhost -U postgres -d hts
```

**Error: S3 bucket not found**
```bash
# Create bucket
aws s3 mb s3://hts-data --region us-east-1

# Verify .env has AWS credentials
cat .env | grep AWS_
```
