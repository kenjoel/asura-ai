// Simple test to verify security scanner detection
console.log("Testing Asura AI Security Scanner...");

// This should trigger CRITICAL: Hardcoded API Key
const apiKey = "sk-1234567890abcdefghijklmnopqrstuvwxyz";

// This should trigger HIGH: SQL Injection
function getUser(id) {
    const query = "SELECT * FROM users WHERE id = " + id;
    return database.execute(query);
}

// This should trigger HIGH: XSS
function displayContent(userInput) {
    document.getElementById('content').innerHTML = userInput;
}

// This should trigger HIGH: Unsafe eval
function runCode(code) {
    return eval(code);
}

// This should trigger MEDIUM: Weak random
function generateId() {
    return Math.random().toString(36);
}

console.log("Test file loaded - check for security warnings!");
