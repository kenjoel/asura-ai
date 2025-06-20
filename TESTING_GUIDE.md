# 🔒 Asura AI Security Scanner - Testing Guide

## How to Test the Security Scanner

### 1. **Setup & Installation**

First, compile the extension:
```bash
npm run compile
```

Then press `F5` in VSCode to launch the Extension Development Host.

### 2. **Test with the Provided Test File**

I've created a `test-security.js` file with intentional vulnerabilities. Open this file in the Extension Development Host to see the security scanner in action.

### 3. **What You Should See**

When you open `test-security.js`, you should immediately see:

#### **Real-time Diagnostics:**
- 🔴 **Red squiggly lines** under vulnerable code
- 📋 **Problems panel** showing security issues
- 🔍 **Hover tooltips** with vulnerability details

#### **Expected Detections:**
- **3 CRITICAL** vulnerabilities (hardcoded secrets)
- **8+ HIGH** vulnerabilities (SQL injection, XSS, weak crypto, etc.)
- **2+ MEDIUM** vulnerabilities (weak random, missing validation)

### 4. **Testing Commands**

Open the Command Palette (`Ctrl+Shift+P`) and try these commands:

#### **Security Scan Commands:**
- `Asura AI: Scan Security` - Full workspace scan
- `Asura AI: Scan Current File` - Scan active file only
- `Asura AI: Show Security Report` - Detailed HTML report
- `Asura AI: Toggle Real-time Scan` - Enable/disable live scanning

### 5. **Step-by-Step Testing**

#### **Test 1: Real-time Scanning**
1. Open `test-security.js`
2. You should see red underlines immediately
3. Hover over any red line to see the security warning
4. Check the Problems panel (View → Problems)

#### **Test 2: Manual File Scan**
1. Run command: `Asura AI: Scan Current File`
2. Should show notification with number of issues found

#### **Test 3: Security Report**
1. Run command: `Asura AI: Show Security Report`
2. Should open a detailed HTML report showing:
   - Summary cards with vulnerability counts
   - Detailed list of all vulnerabilities
   - File locations and fix suggestions

#### **Test 4: Workspace Scan**
1. Run command: `Asura AI: Scan Security`
2. Scans all relevant files in workspace
3. Shows comprehensive security analysis

#### **Test 5: Toggle Real-time Scanning**
1. Run command: `Asura AI: Toggle Real-time Scan`
2. Should show notification about enabling/disabling
3. When disabled, no real-time scanning occurs

### 6. **Create Your Own Test Cases**

Try adding these vulnerable code patterns to test detection:

#### **SQL Injection:**
```javascript
const query = "SELECT * FROM users WHERE id = " + userId;
```

#### **XSS:**
```javascript
element.innerHTML = userInput;
```

#### **Hardcoded Secrets:**
```javascript
const apiKey = "sk-1234567890abcdefghijklmnop";
```

#### **Weak Crypto:**
```javascript
const hash = crypto.createHash('md5').update(data).digest('hex');
```

#### **Command Injection:**
```javascript
exec("ls -la " + userInput);
```

#### **Unsafe eval:**
```javascript
eval(userCode);
```

### 7. **Expected Behavior**

#### **Real-time Scanning:**
- ✅ Scans as you type
- ✅ Updates diagnostics immediately
- ✅ Shows in Problems panel
- ✅ Provides hover tooltips

#### **File Types Supported:**
- ✅ JavaScript (.js)
- ✅ TypeScript (.ts, .tsx)
- ✅ Python (.py)
- ✅ Java (.java)
- ✅ C# (.cs)
- ✅ PHP (.php)
- ✅ Go (.go)
- ✅ Rust (.rs)

#### **Severity Levels:**
- 🔴 **CRITICAL** → Error (red squiggly)
- 🟠 **HIGH** → Error (red squiggly)
- 🟡 **MEDIUM** → Warning (yellow squiggly)
- 🟢 **LOW** → Information (blue squiggly)

### 8. **Troubleshooting**

#### **If you don't see any diagnostics:**
1. Check that the file extension is supported (.js, .ts, etc.)
2. Verify real-time scanning is enabled
3. Check the console for any errors
4. Try manually running "Scan Current File"

#### **If commands don't appear:**
1. Make sure the extension is activated
2. Check that you're in the Extension Development Host
3. Verify the extension compiled successfully

#### **If the security report doesn't open:**
1. Check for popup blockers
2. Look for any console errors
3. Try running the workspace scan first

### 9. **Performance Testing**

#### **Large File Testing:**
1. Create a large JavaScript file (1000+ lines)
2. Add some vulnerabilities throughout
3. Verify scanning performance is acceptable
4. Check that diagnostics update smoothly

#### **Multiple File Testing:**
1. Create several files with vulnerabilities
2. Run workspace scan
3. Verify all files are scanned
4. Check the security report includes all files

### 10. **Advanced Testing**

#### **Custom Rules Testing:**
```javascript
// Test adding custom security rules
const scanner = new CodeSecurityScanner(securityService, context);
scanner.addCustomRule({
  id: 'custom-test',
  name: 'Custom Test Rule',
  type: VulnerabilityType.INFORMATION_DISCLOSURE,
  severity: SeverityLevel.MEDIUM,
  pattern: /console\.log\(/gi,
  languages: ['javascript', 'typescript'],
  description: 'Console.log may leak sensitive information',
  suggestion: 'Remove console.log statements in production',
  enabled: true
});
```

### 11. **Integration Testing**

#### **With Git (Pre-commit simulation):**
1. Make changes to files with vulnerabilities
2. The scanner should detect issues before commit
3. Should show warnings about security issues

#### **With VSCode Features:**
1. Test with different themes (dark/light)
2. Test with different font sizes
3. Test with multiple editor panes
4. Test with split view

### 12. **Expected Output Examples**

#### **Console Output:**
```
Security service initialized
Real-time security scanning enabled
Found 13 security issue(s) in test-security.js
```

#### **Problems Panel:**
```
Asura Security: Hardcoded API Key: Hardcoded API key or secret detected
Asura Security: SQL Injection - String Concatenation: SQL query uses string concatenation
Asura Security: XSS - innerHTML with user input: Setting innerHTML with dynamic content
```

#### **Security Report:**
- Visual dashboard with color-coded severity counts
- Detailed vulnerability listings
- File locations and line numbers
- Fix suggestions for each issue

This comprehensive testing approach will help you verify that the security scanner is working correctly and catching vulnerabilities as expected!
