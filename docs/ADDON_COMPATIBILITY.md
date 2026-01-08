# Addon Compatibility Testing System

This document describes the automated compatibility testing system for `qvac-test-addon-mobile`. This system ensures that changes to the mobile testing framework don't break existing addons.

## Overview

Since `qvac-test-addon-mobile` is the base repository for mobile testing across all QVAC addons (both Android and iOS), we need to ensure that:

1. **Framework changes don't break addons**: PRs to this repo are automatically tested against all registered addons
2. **Build compatibility is maintained**: The build system can successfully generate test apps for each addon
3. **Test extraction works**: Test functions are correctly extracted from addon test files
4. **Bundling succeeds**: The app bundle is created without errors

## How It Works

### 1. Addon Registry

All addons that should be tested for compatibility are registered in `.github/addon-registry.json`:

```json
{
  "addons": [
    {
      "name": "@qvac/llm-llamacpp",
      "repository": "tetherto/qvac-lib-infer-llamacpp-llm",
      "branch": "main",
      "testPath": "test/mobile",
      "platforms": ["Android", "iOS"]
    }
  ]
}
```

### 2. PR Workflow

When a PR is opened or updated, the `addon-compatibility-check.yml` workflow:

1. **Loads the addon registry** - Reads all registered addons
2. **Builds test apps** - For each addon, runs the build script to generate:
   - `backend/backend.cjs` - Test backend code
   - `app/testConfig.js` - Test function configuration
   - `e2e/tests/app.test.js` - E2E test file
   - `backend/app.bundle` - Bundled application
3. **Generates native projects** - Runs `expo prebuild` for Android/iOS
4. **Reports results** - Comments on the PR with compatibility status

### 3. Local Validation

Before submitting a PR, developers can validate compatibility locally:

```bash
# Test all registered addons
npm run validate

# Test specific addon
npm run validate -- --addon @qvac/llm-llamacpp

# Test local addon directory
npm run validate:local ../path/to/addon
```

## Adding New Addons

To register a new addon for compatibility testing:

1. Edit `.github/addon-registry.json`
2. Add your addon configuration:

```json
{
  "name": "@qvac/your-addon",
  "repository": "tetherto/your-addon-repo",
  "branch": "main",
  "testPath": "test/mobile",
  "hasIntegrationTests": false,
  "prebuildArtifactPrefix": "your-addon-",
  "description": "Description of your addon",
  "priority": "high",
  "platforms": ["Android", "iOS"]
}
```

### Required Fields

| Field | Description |
|-------|-------------|
| `name` | NPM package name (e.g., `@qvac/llm-llamacpp`) |
| `repository` | GitHub repository (e.g., `tetherto/qvac-lib-infer-llamacpp-llm`) |
| `branch` | Branch to test against |
| `testPath` | Path to mobile tests in the addon |
| `platforms` | Array of platforms to test (`Android`, `iOS`, or both) |

### Optional Fields

| Field | Description |
|-------|-------------|
| `hasIntegrationTests` | Whether addon has integration tests |
| `prebuildArtifactPrefix` | Prefix for prebuild artifacts |
| `description` | Human-readable description |
| `priority` | `high`, `medium`, or `low` |

## Addon Requirements

For an addon to be compatible with this framework, it must have:

### Directory Structure

```
your-addon/
├── package.json
├── test/
│   └── mobile/
│       ├── *.cjs              # Test files
│       ├── testAssets/        # (optional) Test assets
│       └── integration.auto.cjs  # (optional) Integration test runner
└── ...
```

### Test File Format

Test files in `test/mobile/` must be `.cjs` files with async functions:

```javascript
// test/mobile/my-tests.cjs

async function test_my_feature() {
  // Test implementation
  return { success: true }
}

async function test_another_feature() {
  // Another test
  return { success: true }
}
```

### Test Function Signatures

Supported function signatures:

```javascript
// No parameters - automated test
async function test_basic() { }

// With dirPath and getAssetPath - automated test with assets
async function test_with_assets(dirPath, getAssetPath) { }

// With audioData - manual test (requires user recording)
async function test_mic_recording(audioData) { }
```

## Workflow Configuration

### Environment Variables

The workflow uses these environment variables:

| Variable | Description |
|----------|-------------|
| `NODE_VERSION` | Node.js version to use |
| `APP_BUNDLE_ID` | App bundle identifier |

### Secrets Required

| Secret | Description |
|--------|-------------|
| `PAT_TOKEN` | GitHub Personal Access Token for private repos |
| `NPM_TOKEN` | NPM token for @qvac packages |
| `GITHUB_TOKEN` | Auto-provided by GitHub Actions |

### Optional: Device Farm Testing

To enable full E2E testing on AWS Device Farm, configure:

| Secret | Description |
|--------|-------------|
| `AWS_ACCESS_KEY_ID` | AWS credentials |
| `AWS_SECRET_ACCESS_KEY` | AWS credentials |
| `AWS_DEVICE_FARM_PROJECT_ARN` | Device Farm project ARN |
| `ANDROID_DEVICE_POOL_ARN` | Android device pool |
| `IOS_DEVICE_POOL_ARN` | iOS device pool |
| `APPLE_DISTRIBUTION_CERTIFICATE` | iOS signing certificate |
| `APPLE_P12_PASSWORD` | Certificate password |
| `APPLE_PROVISIONING_PROFILE` | iOS provisioning profile |
| `APPLE_KEYCHAIN_PASSWORD` | Keychain password |
| `APPLE_TEAM_ID` | Apple Team ID |

## Troubleshooting

### Build Failures

If the build fails for an addon:

1. **Check test file syntax**: Ensure all `.cjs` files are valid JavaScript
2. **Verify dependencies**: Run `npm install` in the addon directory
3. **Check for missing assets**: Ensure `testAssets/` contains required files

### Local Validation Fails

If local validation fails:

1. **Ensure addon is accessible**: The script searches `../` and `node_modules/`
2. **Use `--local` flag**: Specify exact path to addon
3. **Check verbose output**: Run with `--verbose` for details

### PR Check Fails

If the PR check fails:

1. **Review workflow logs**: Check GitHub Actions output
2. **Test locally first**: Run `npm run validate` before pushing
3. **Check addon compatibility**: Ensure addon follows required structure

## Best Practices

1. **Always validate locally** before submitting PRs
2. **Add new addons to registry** when they're production-ready
3. **Keep registry up to date** when addon repos change
4. **Test both platforms** to ensure cross-platform compatibility
5. **Document breaking changes** when they affect addons

