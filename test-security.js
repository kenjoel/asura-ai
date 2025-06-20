// Test file for Asura AI Security Scanner
// This file contains intentional security vulnerabilities for testing

// 1. CRITICAL: Hardcoded API Keys
const openaiKey = "sk-1234567890abcdefghijklmnopqrstuvwxyz";
const secretToken = "ghp_abcdefghijklmnopqrstuvwxyz123456789";
const password = "mySecretPassword123!";

// 2. HIGH: SQL Injection vulnerabilities
function getUserData(userId) {
    const query = "SELECT * FROM users WHERE id = " + userId;
    return database.execute(query);
}

function searchUsers(searchTerm) {
    const sql = `SELECT * FROM users WHERE name LIKE '%${searchTerm}%'`;
    return db.query(sql);
}

// 3. HIGH: XSS vulnerabilities
function displayUserContent(userInput) {
    document.getElementById('content').innerHTML = userInput;
    element.innerHTML = getData();
}

// 4. HIGH: Command Injection
function executeCommand(userCommand) {
    const result = exec("ls -la " + userCommand);
    return result;
}

// 5. HIGH: Unsafe eval usage
function processUserCode(code) {
    return eval(code);
}

// 6. HIGH: Weak cryptographic algorithms
const crypto = require('crypto');
function hashPassword(password) {
    return crypto.createHash('md5').update(password).digest('hex');
}

function encryptData(data) {
    const cipher = crypto.createCipher('des', 'secret');
    return cipher.update(data, 'utf8', 'hex') + cipher.final('hex');
}

// 7. HIGH: Path Traversal
function readUserFile(filename) {
    const fs = require('fs');
    return fs.readFile('./uploads/' + filename + '../../../etc/passwd');
}

// 8. MEDIUM: Weak random number generation
function generateToken() {
    return Math.random().toString(36).substring(2);
}

// 9. MEDIUM: Missing input validation
function processRequest(req, res) {
    const userId = req.params.id;
    const userData = req.body.data;
    
    // Direct usage without validation
    database.updateUser(userId, userData);
}

// 10. HIGH: Insecure deserialization (Python-style for demo)
// const pickle = require('pickle');
// function loadUserData(serializedData) {
//     return pickle.loads(serializedData);
// }

// 11. More SQL injection patterns
function loginUser(username, password) {
    const query = `SELECT * FROM users WHERE username = '${username}' AND password = '${password}'`;
    return db.execute(query);
}

// 12. More XSS patterns
function renderTemplate(template, data) {
    template.innerHTML = data.content;
}

// 13. More command injection
function pingHost(host) {
    return system(`ping -c 1 ${host}`);
}

// 14. Weak crypto continued
function createHash(input) {
    return sha1(input);
}

// 15. More hardcoded secrets
const config = {
    apiKey: "abc123def456ghi789jkl012mno345pqr",
    secret: "supersecretkey12345",
    token: "bearer_token_abcdefghijklmnop"
};

console.log("Security test file loaded - check for vulnerability warnings!");
