// DEBUG SCRIPT - Run this to test Mailjet configuration
// Save as: test-mailjet.js
// Run with: node test-mailjet.js

require('dotenv').config();
const Mailjet = require('node-mailjet');

console.log('\n🔍 MAILJET CONFIGURATION CHECK\n');
console.log('=' .repeat(50));

// Step 1: Check environment variables
console.log('\n1️⃣ Environment Variables Check:');
console.log('   MAILJET_API_KEY:', process.env.MAILJET_API_KEY ? '✅ Set' : '❌ NOT SET');
console.log('   MAILJET_SECRET_KEY:', process.env.MAILJET_SECRET_KEY ? '✅ Set' : '❌ NOT SET');
console.log('   MAILJET_FROM_EMAIL:', process.env.MAILJET_FROM_EMAIL || '❌ NOT SET');
console.log('   MAILJET_FROM_NAME:', process.env.MAILJET_FROM_NAME || 'Not set (optional)');
console.log('   ADMIN_EMAIL:', process.env.ADMIN_EMAIL || 'Not set');

if (!process.env.MAILJET_API_KEY || !process.env.MAILJET_SECRET_KEY) {
  console.error('\n❌ ERROR: Mailjet credentials not configured!');
  console.log('\n📝 To fix:');
  console.log('   1. Go to https://app.mailjet.com/account/api_keys');
  console.log('   2. Copy your API Key and Secret Key');
  console.log('   3. Add to your .env file:');
  console.log('      MAILJET_API_KEY=your_api_key_here');
  console.log('      MAILJET_SECRET_KEY=your_secret_key_here');
  process.exit(1);
}

// Step 2: Display credentials format (partial)
console.log('\n2️⃣ Credentials Format Check:');
console.log('   API Key starts with:', process.env.MAILJET_API_KEY.substring(0, 10) + '...');
console.log('   Secret Key starts with:', process.env.MAILJET_SECRET_KEY.substring(0, 10) + '...');
console.log('   API Key length:', process.env.MAILJET_API_KEY.length, 'chars');
console.log('   Secret Key length:', process.env.MAILJET_SECRET_KEY.length, 'chars');

// Step 3: Initialize Mailjet client
console.log('\n3️⃣ Initializing Mailjet Client...');
const mailjetClient = Mailjet.apiConnect(
  process.env.MAILJET_API_KEY,
  process.env.MAILJET_SECRET_KEY
);
console.log('   ✅ Client initialized');

// Step 4: Test email sending
async function testEmailSend() {
  const testEmail = process.env.ADMIN_EMAIL || 'test@example.com';
  
  console.log('\n4️⃣ Attempting to Send Test Email...');
  console.log('   From:', process.env.MAILJET_FROM_EMAIL);
  console.log('   To:', testEmail);
  
  try {
    const request = mailjetClient
      .post('send', { version: 'v3.1' })
      .request({
        Messages: [
          {
            From: {
              Email: process.env.MAILJET_FROM_EMAIL,
              Name: process.env.MAILJET_FROM_NAME || 'Test Sender'
            },
            To: [
              {
                Email: testEmail,
                Name: 'Test Recipient'
              }
            ],
            Subject: '🧪 Mailjet Test - Chaxx Barbershop',
            TextPart: 'This is a test email from Chaxx Barbershop booking system.',
            HTMLPart: `
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="UTF-8">
                <style>
                  body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
                  .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                  .success { color: #10b981; font-size: 24px; font-weight: bold; }
                  .info { background: #f0f9ff; padding: 15px; border-radius: 5px; margin: 20px 0; }
                </style>
              </head>
              <body>
                <div class="container">
                  <p class="success">✅ Email Working!</p>
                  <p>If you're reading this, your Mailjet integration is working perfectly!</p>
                  <div class="info">
                    <strong>Test Details:</strong><br>
                    Time: ${new Date().toLocaleString()}<br>
                    From: ${process.env.MAILJET_FROM_EMAIL}<br>
                    To: ${testEmail}
                  </div>
                  <p><strong>Chaxx Barbershop Booking System</strong></p>
                </div>
              </body>
              </html>
            `
          }
        ]
      });

    const response = await request;
    
    console.log('\n✅ EMAIL SENT SUCCESSFULLY!\n');
    console.log('Response Status:', response.response.status);
    console.log('Response Data:', JSON.stringify(response.body, null, 2));
    
    if (response.body.Messages && response.body.Messages[0]) {
      const msg = response.body.Messages[0];
      console.log('\n📬 Message Details:');
      console.log('   Status:', msg.Status);
      console.log('   Message ID:', msg.To[0].MessageID);
      console.log('   Message UUID:', msg.To[0].MessageUUID);
    }
    
    console.log('\n✨ SUCCESS! Check your email inbox (and spam folder).\n');
    console.log('=' .repeat(50));
    
  } catch (error) {
    console.error('\n❌ EMAIL SEND FAILED!\n');
    console.error('Error Message:', error.message);
    console.error('Status Code:', error.statusCode);
    
    if (error.response && error.response.body) {
      console.error('\nDetailed Error Response:');
      console.error(JSON.stringify(error.response.body, null, 2));
    }
    
    console.log('\n🔧 TROUBLESHOOTING STEPS:\n');
    
    // Common error scenarios
    if (error.statusCode === 401) {
      console.log('❌ AUTHENTICATION FAILED (401)');
      console.log('   Problem: Invalid API credentials');
      console.log('   Solution:');
      console.log('   1. Go to https://app.mailjet.com/account/api_keys');
      console.log('   2. Verify your API Key and Secret Key are correct');
      console.log('   3. Make sure you copied them completely (no extra spaces)');
      console.log('   4. Try regenerating new keys if needed');
    } 
    else if (error.statusCode === 400) {
      console.log('❌ BAD REQUEST (400)');
      console.log('   Problem: Invalid email format or sender not verified');
      console.log('   Solution:');
      console.log('   1. Go to https://app.mailjet.com/account/sender');
      console.log('   2. Verify your sender email address');
      console.log('   3. Check that MAILJET_FROM_EMAIL matches a verified address');
      console.log('   4. Make sure email addresses are valid format');
    }
    else if (error.statusCode === 403) {
      console.log('❌ FORBIDDEN (403)');
      console.log('   Problem: API key doesn\'t have permission');
      console.log('   Solution:');
      console.log('   1. Ensure your API key has "Send transactional emails" permission');
      console.log('   2. Check if your Mailjet account is active');
      console.log('   3. Verify you haven\'t exceeded daily limits (200/day free)');
    }
    else if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
      console.log('❌ CONNECTION ERROR');
      console.log('   Problem: Cannot reach Mailjet servers');
      console.log('   Solution:');
      console.log('   1. Check your internet connection');
      console.log('   2. Verify no firewall is blocking api.mailjet.com');
      console.log('   3. Try again in a few moments');
    }
    else {
      console.log('❌ UNKNOWN ERROR');
      console.log('   Try the following:');
      console.log('   1. Double-check all environment variables');
      console.log('   2. Verify sender email is confirmed in Mailjet dashboard');
      console.log('   3. Check Mailjet status: https://status.mailjet.com');
      console.log('   4. Review error details above');
    }
    
    console.log('\n=' .repeat(50));
    process.exit(1);
  }
}

// Step 5: Check Mailjet account status
async function checkAccountStatus() {
  console.log('\n5️⃣ Checking Mailjet Account Status...');
  
  try {
    const request = mailjetClient
      .get('sender')
      .request();
    
    const response = await request;
    
    console.log('   ✅ Account is active');
    console.log('   Total verified senders:', response.body.Count);
    
    if (response.body.Data && response.body.Data.length > 0) {
      console.log('\n   Verified Sender Addresses:');
      response.body.Data.forEach((sender, idx) => {
        console.log(`   ${idx + 1}. ${sender.Email} (Status: ${sender.Status})`);
      });
      
      // Check if FROM email is verified
      const fromEmail = process.env.MAILJET_FROM_EMAIL;
      const isVerified = response.body.Data.some(s => 
        s.Email.toLowerCase() === fromEmail.toLowerCase() && s.Status === 'Active'
      );
      
      if (isVerified) {
        console.log(`\n   ✅ Your FROM email (${fromEmail}) is verified!`);
      } else {
        console.log(`\n   ⚠️ WARNING: ${fromEmail} may not be verified!`);
        console.log('   Go to: https://app.mailjet.com/account/sender');
      }
    }
  } catch (error) {
    console.log('   ⚠️ Could not fetch account status');
    console.log('   This is optional - continuing with email test...');
  }
}

// Run all tests
(async () => {
  try {
    await checkAccountStatus();
    await testEmailSend();
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
})();