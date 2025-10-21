# QVAC Addon Mobile Tester

A template project for testing native addons on mobile platforms (iOS and Android). This app enables immediate on-device testing for addons during development without requiring custom example apps.


## Overview

This is a React Native + Bare runtime application that:
- Loads addon test code from the addon's `test/mobile/test.cjs` file
- Automatically initializes and runs tests via the `startTest()` function
- Provides RPC communication between React Native UI and Bare backend
- Includes WebDriverIO e2e tests for CI/CD integration

## Architecture

```
┌─────────────────────┐
│   React Native UI   │  (app/index.js)
│   - Displays status │
│   - Triggers tests  │
└──────────┬──────────┘
           │ RPC (bare-rpc)
           │ Commands: INIT, START_TEST
┌──────────▼──────────┐
│   Bare Backend      │  (backend/backend.cjs)
│   - init()          │  Static: sets dirPath
│   - startTest()     │  <- Injected from addon's test/mobile/test.cjs
│                     │     (contains all test logic)
└─────────────────────┘
```

## Prerequisites

- Node.js 18+
- For Android: Android SDK, Android Studio
- For iOS: Xcode, CocoaPods
- An addon with `test/mobile/test.cjs` file

## Quick Start

### 1. Build the Test App

From the template project root:

```bash
npm run build ../path-to-addon
```

For example, to test the embeddings addon:

```bash
npm run build ../qvac-lib-infer-llamacpp-embed
```

This script will:
- ✅ Extract test code from addon's `test/mobile/test.cjs`
- ✅ Install the addon package
- ✅ Install test dependencies (from addon's devDependencies)
- ✅ Generate `backend/backend.cjs` with injected test logic
- ✅ Bundle the app using `bare-pack`

### 2. Run on Device/Simulator

#### Android
```bash
npm run android
```

#### iOS
```bash
npm run ios
```

The app will automatically:
1. Initialize (set dirPath for test assets)
2. Run the test via `startTest()` function
3. Display test results and status updates

If any error occurs, it will display: "Error: [error message]"

## Creating Tests for Your Addon

### Step 1: Create Test File

In your addon repository, create `test/mobile/test.cjs`:

```javascript
'use strict'

const YourAddon = require('@your-org/your-addon')
// Import other dependencies needed for testing

// Module-level variables
let modelInstance = null

/**
 * Main test function - this is the required entry point
 * The global variable 'dirPath' is available and points to testAssets directory
 * @returns {Promise<string>}
 */
async function startTest() {
  try {
    // Step 1: Load the model
    console.log('Starting model load...')
    console.log('Assets directory:', dirPath)
    
    modelInstance = new YourAddon({
      diskPath: dirPath,
      // other configuration
    })
    
    await modelInstance.load()
    console.log('Model loaded successfully')
    
    // Step 2: Run inference with hardcoded test input
    console.log('Starting model inference...')
    const testInput = 'your test input'
    const result = await modelInstance.run(testInput)
    
    // Validate output
    if (!result) {
      throw new Error('Model returned empty result')
    }
    
    console.log('Inference result:', result)
    
    // Step 3: Cleanup and unload
    console.log('Unloading model...')
    await modelInstance.unload()
    modelInstance = null
    console.log('Model unloaded successfully')
    
    // Return success message
    return 'TEST COMPLETE: Model loaded, ran inference, and unloaded successfully'
    
  } catch (error) {
    console.error('Test failed:', error)
    throw new Error(`Test failed: ${error.message}`)
  }
}

// You can define multiple test functions and call them from startTest()
async function testMultipleScenarios() {
  // Run multiple test scenarios
  const results = []
  results.push(await testScenario1())
  results.push(await testScenario2())
  return results.join('\n')
}

// Export is optional - the build script extracts the code
module.exports = {
  startTest
}
```

### Step 2: (Optional) Add Test Assets

If your addon requires model files or other assets, create a `test/mobile/testAssets/` folder:

```
your-addon/
├── test/
│   └── mobile/
│       ├── test.cjs
│       └── testAssets/
│           └── model.gguf
```

The build script will automatically copy `testAssets/` to the mobile app.

### Step 3: Build and Test

```bash
cd path/to/qvac-addon-mobile-tester
npm run build ../your-addon
npm run android  # or npm run ios
```

## Running E2E Tests

The template includes WebDriverIO tests that can run on physical devices or emulators.

### Prerequisites

Make sure you have:
- Android: Emulator running or device connected via ADB
- iOS: Simulator running or device connected

### Run Tests

```bash
# Android
cd e2e
npm run test:android

# iOS
cd e2e
npm run test:ios
```

### What the E2E Test Does

The test (`e2e/tests/app.test.js`):
1. Launches the app
2. Finds the text element with `testID="text"`
3. Waits for "INITIALIZED" status
4. Waits for test completion (status from your `startTest()` return value)
5. Fails if any error message is displayed

### CI/CD Integration

For AWS Device Farm or CI pipelines:

1. Build the app:
```bash
npm run build ../your-addon
npm run android  # builds APK
```

2. Upload APK to Device Farm
3. Run e2e tests against the uploaded build

## Project Structure

```
qvac-addon-mobile-tester/
├── app/
│   ├── index.js              # Main React Native app
│   └── hooks/
│       └── useWorklet.js     # Bare worklet hook for RPC
├── backend/
│   ├── backend.cjs           # Generated: contains injected test logic
│   ├── api.cjs               # RPC command constants
│   └── app.bundle            # Generated: bundled backend
├── e2e/
│   ├── package.json
│   └── tests/
│       ├── app.test.js       # WebDriverIO test
│       ├── wdio.config.android.js
│       └── wdio.config.ios.js
├── scripts/
│   ├── build-test-app.js     # Main build script
│   └── bundle.sh             # Bare-pack bundling script
├── testAssets/               # Generated: copied from addon
├── package.json
└── README.md
```

## Build Script Details

The `scripts/build-test-app.js` script performs these steps:

1. **Install Addon**: Packs (if directory) and installs the addon as npm package
2. **Get Package Name**: Extracts the package name from the installed addon
3. **Read Test Code**: Reads `test/mobile/test.cjs` from node_modules
4. **Extract Logic**: Removes `module.exports` and extracts the test functions
5. **Extract Dependencies**: Parses `require()` statements to find test dependencies
6. **Install Test Dependencies**: Installs dependencies from addon's `devDependencies` or `dependencies`
7. **Generate Backend**: Creates `backend/backend.cjs` with:
   - Static `init()` function (sets global `dirPath`)
   - Injected test logic (including your `startTest()` function)
   - RPC request handlers (handleInit, handleStartTest)
   - Command routing (INIT, START_TEST)
8. **Copy Assets**: Copies `test/mobile/testAssets/` to project root if it exists
9. **Bundle**: Runs `bare-pack` to create the final app bundle

## Troubleshooting

### Build fails with "Cannot find module"

**Solution**: Make sure all dependencies used in `test/mobile/test.cjs` are listed in your addon's `package.json` (either `dependencies` or `devDependencies`).

### App shows "RPC NOT WORKING"

**Solution**: The Bare worklet failed to initialize. Check:
- The bundle was created successfully (`backend/app.bundle` exists)
- No syntax errors in `backend/backend.cjs`
- Run `npm run barelog` to see Bare logs

### Model loading fails

**Solution**: Check:
- Model files are in `testAssets/` folder
- File paths in test code match the actual file locations
- Sufficient device storage/memory

### E2E test times out

**Solution**:
- Increase timeout in `e2e/tests/app.test.js`
- Check if app is actually running on device/emulator
- Look at app logs with `npm run barelog` (Android)

## Advanced Usage

### Custom Test Timing

The app has a 3-second delay before INIT and 5-second delay before START_TEST. To modify:

Edit `app/index.js`:
```javascript
setTimeout(() => {
  init()
}, 3000) // Change this value

setTimeout(() => {
  startTest()
}, 5000) // Change this value
```

### Multiple Test Scenarios

To test multiple scenarios, define multiple test functions in your `test/mobile/test.cjs` and call them from `startTest()`:

```javascript
async function startTest() {
  const results = []
  results.push(await testScenario1())
  results.push(await testScenario2())
  results.push(await testScenario3())
  return results.join('\n')
}
```

### Accessing Test Assets

The global `dirPath` variable is available in your test code and points to the testAssets directory:

```javascript
async function startTest() {
  console.log('Assets are in:', dirPath)
  // Use dirPath to access model files, data, etc.
}
```

### Adding UI Controls

The template intentionally has minimal UI. To add buttons or controls:

1. Edit `app/index.js` to add React Native components
2. Create functions that call RPC methods (INIT, START_TEST)
3. Update e2e tests accordingly

## Contributing

We welcome contributions to improve this mobile testing template! 

### For Template Improvements

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Commit your changes: `git commit -m "Add some feature"`
5. Push to the branch: `git push origin feature/your-feature`
6. Open a Pull Request

### For Adding Addon Support

When adding support for new addons:

1. Create `test/mobile/test.cjs` in your addon repository
2. Define a `startTest()` async function as the main entry point
3. Use the global `dirPath` variable to access testAssets
4. Use hardcoded test inputs (no user interaction)
5. Return a descriptive status string (e.g., "TEST COMPLETE: All tests passed")
6. Throw descriptive errors with `Error()` constructor
7. Optionally add `test/mobile/testAssets/` for model files or test data
8. Test with this template using `npm run build ../your-addon`

## Related Documentation

- [Proposal Document](./Proposal_%20Default%20mobile%20app%20for%20addon%20testing%20with%20script%20loading%20support.md)
- [Bare Runtime](https://github.com/holepunchto/bare)
- [React Native Bare Kit](https://github.com/holepunchto/react-native-bare-kit)
- [WebDriverIO](https://webdriver.io/)

## License

Apache-2.0


