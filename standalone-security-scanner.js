#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Security rules for vulnerability detection
const SECURITY_RULES = [
  {
    id: 'hardcoded-api-key',
    name: 'Hardcoded API Key',
    severity: 'CRITICAL',
    pattern: /(?:api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*["']([a-zA-Z0-9_-]{20,})["']/gi,
    description: 'Hardcoded API key or secret detected',
    suggestion: 'Move secrets to environment variables or secure configuration'
  },
  {
    id: 'hardcoded-password',
    name: 'Hardcoded Password',
    severity: 'CRITICAL',
    pattern: /(?:password|pwd|pass)\s*[:=]\s*["']([^"']{8,})["']/gi,
    description: 'Hardcoded password detected',
    suggestion: 'Use secure password storage or environment variables'
  },
  {
    id: 'sql-injection-concat',
    name: 'SQL Injection - String Concatenation',
    severity: 'HIGH',
    pattern: /(?:SELECT|INSERT|UPDATE|DELETE).*\+.*(?:WHERE|VALUES|SET)/gi,
    description: 'SQL query uses string concatenation which may lead to SQL injection',
    suggestion: 'Use parameterized queries or prepared statements'
  },
  {
    id: 'xss-innerhtml',
    name: 'XSS - innerHTML with user input',
    severity: 'HIGH',
    pattern: /\.innerHTML\s*=\s*(?!["'])/gi,
    description: 'Setting innerHTML with dynamic content may lead to XSS',
    suggestion: 'Use textContent or sanitize input before setting innerHTML'
  },
  {
    id: 'unsafe-eval',
    name: 'Unsafe eval()',
    severity: 'HIGH',
    pattern: /\beval\s*\(/gi,
    description: 'Use of eval() can lead to code injection vulnerabilities',
    suggestion: 'Avoid eval() or use safer alternatives like JSON.parse()'
  },
  {
    id: 'command-injection',
    name: 'Command Injection',
    severity: 'HIGH',
    pattern: /(?:exec|spawn|system)\s*\([^)]*\+/gi,
    description: 'Command execution with string concatenation may lead to command injection',
    suggestion: 'Use parameterized command execution or input validation'
  },
  {
    id: 'weak-crypto-md5',
    name: 'Weak Cryptography - MD5',
    severity: 'HIGH',
    pattern: /\.createHash\s*\(\s*["']md5["']\s*\)/gi,
    description: 'MD5 is cryptographically broken and should not be used',
    suggestion: 'Use SHA-256 or stronger hashing algorithms'
  },
  {
    id: 'weak-crypto-sha1',
    name: 'Weak Cryptography - SHA1',
    severity: 'HIGH',
    pattern: /\.createHash\s*\(\s*["']sha1["']\s*\)/gi,
    description: 'SHA1 is cryptographically weak and should be avoided',
    suggestion: 'Use SHA-256 or stronger hashing algorithms'
  },
  {
    id: 'weak-random',
    name: 'Weak Random Number Generation',
    severity: 'MEDIUM',
    pattern: /Math\.random\(\)/gi,
    description: 'Math.random() is not cryptographically secure',
    suggestion: 'Use crypto.randomBytes() for security-sensitive random numbers'
  },
  {
    id: 'missing-input-validation',
    name: 'Missing Input Validation',
    severity: 'MEDIUM',
    pattern: /req\.(?:body|query|params)\.[a-zA-Z_$][a-zA-Z0-9_$]*(?!\s*&&|\s*\|\||\s*\?)/gi,
    description: 'User input used without validation',
    suggestion: 'Validate and sanitize all user inputs'
  }
];

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

// Severity color mapping
const severityColors = {
  'CRITICAL': colors.red,
  'HIGH': colors.red,
  'MEDIUM': colors.yellow,
  'LOW': colors.blue
};

class SecurityScanner {
  constructor() {
    this.vulnerabilities = [];
  }

  scanFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      
      console.log(`\n${colors.cyan}🔍 Scanning: ${filePath}${colors.reset}`);
      
      let fileVulnerabilities = [];
      
      SECURITY_RULES.forEach(rule => {
        let match;
        rule.pattern.lastIndex = 0; // Reset regex
        
        while ((match = rule.pattern.exec(content)) !== null) {
          const lineNumber = content.substring(0, match.index).split('\n').length;
          const line = lines[lineNumber - 1];
          
          const vulnerability = {
            file: filePath,
            line: lineNumber,
            rule: rule.id,
            name: rule.name,
            severity: rule.severity,
            description: rule.description,
            suggestion: rule.suggestion,
            code: line.trim(),
            match: match[0]
          };
          
          fileVulnerabilities.push(vulnerability);
          this.vulnerabilities.push(vulnerability);
        }
      });
      
      if (fileVulnerabilities.length > 0) {
        console.log(`${colors.red}❌ Found ${fileVulnerabilities.length} security issue(s)${colors.reset}\n`);
        
        fileVulnerabilities.forEach(vuln => {
          const severityColor = severityColors[vuln.severity] || colors.reset;
          console.log(`${severityColor}${colors.bright}[${vuln.severity}]${colors.reset} ${vuln.name}`);
          console.log(`  📍 Line ${vuln.line}: ${vuln.code}`);
          console.log(`  📝 ${vuln.description}`);
          console.log(`  💡 ${vuln.suggestion}\n`);
        });
      } else {
        console.log(`${colors.green}✅ No security issues found${colors.reset}`);
      }
      
      return fileVulnerabilities;
    } catch (error) {
      console.error(`${colors.red}❌ Error scanning ${filePath}: ${error.message}${colors.reset}`);
      return [];
    }
  }

  scanDirectory(dirPath) {
    const supportedExtensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cs', '.php', '.go', '.rs'];
    
    function getAllFiles(dir) {
      let files = [];
      const items = fs.readdirSync(dir);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
          files = files.concat(getAllFiles(fullPath));
        } else if (stat.isFile() && supportedExtensions.includes(path.extname(item))) {
          files.push(fullPath);
        }
      }
      
      return files;
    }
    
    const files = getAllFiles(dirPath);
    console.log(`${colors.cyan}🔍 Scanning ${files.length} files in ${dirPath}${colors.reset}`);
    
    files.forEach(file => this.scanFile(file));
  }

  generateReport() {
    console.log(`\n${colors.bright}${colors.cyan}📊 SECURITY SCAN REPORT${colors.reset}`);
    console.log(`${'='.repeat(50)}`);
    
    const summary = this.vulnerabilities.reduce((acc, vuln) => {
      acc[vuln.severity] = (acc[vuln.severity] || 0) + 1;
      return acc;
    }, {});
    
    console.log(`\n${colors.bright}Summary:${colors.reset}`);
    Object.entries(summary).forEach(([severity, count]) => {
      const color = severityColors[severity] || colors.reset;
      console.log(`  ${color}${severity}:${colors.reset} ${count}`);
    });
    
    console.log(`\n${colors.bright}Total Issues: ${this.vulnerabilities.length}${colors.reset}`);
    
    if (this.vulnerabilities.length > 0) {
      console.log(`\n${colors.bright}Recommendations:${colors.reset}`);
      console.log(`  🔒 Fix CRITICAL and HIGH severity issues immediately`);
      console.log(`  🛡️  Review MEDIUM severity issues for security best practices`);
      console.log(`  📚 Consider security training for development team`);
      console.log(`  🔄 Run security scans regularly in CI/CD pipeline`);
    } else {
      console.log(`\n${colors.green}🎉 Great! No security vulnerabilities detected.${colors.reset}`);
    }
  }
}

// Main execution
function main() {
  console.log(`${colors.bright}${colors.magenta}🔒 Asura AI Security Scanner${colors.reset}`);
  console.log(`${colors.cyan}Advanced vulnerability detection for secure code${colors.reset}\n`);
  
  const scanner = new SecurityScanner();
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    // Scan current directory
    scanner.scanDirectory('.');
  } else {
    // Scan specified files/directories
    args.forEach(target => {
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        scanner.scanDirectory(target);
      } else {
        scanner.scanFile(target);
      }
    });
  }
  
  scanner.generateReport();
  
  // Exit with error code if vulnerabilities found
  process.exit(scanner.vulnerabilities.length > 0 ? 1 : 0);
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = SecurityScanner;
