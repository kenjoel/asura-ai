// Debug test for security scanner
console.log("Starting security scanner debug test...");

// Test 1: Hardcoded API key (should be CRITICAL)
const apiKey = "sk-1234567890abcdefghijklmnop";

// Test 2: SQL injection (should be HIGH)
function getUserData(userId) {
    const query = "SELECT * FROM users WHERE id = " + userId;
    return db.query(query);
}

// Test 3: XSS vulnerability (should be HIGH)
function displayMessage(msg) {
    document.getElementById('output').innerHTML = msg;
}

console.log("Debug test complete - check for security warnings!");
