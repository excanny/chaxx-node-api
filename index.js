const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const cors = require('cors');
const Mailjet = require('node-mailjet');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB configuration
const MONGODB_URI = process.env.MONGODB_URI;

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected successfully');
    seedAdminUser();
  })
  .catch(err => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });

// ================= MONGOOSE SCHEMAS =================
const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    unique: true,
    sparse: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String
  }
}, {
  timestamps: true
});

const bookingSchema = new mongoose.Schema({
  customer_name: {
    type: String,
    required: true
  },
  phone_number: {
    type: String,
    required: true
  },
  email: {
    type: String,
    default: null
  },
  appointment_time: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'cancelled', 'completed'],
    default: 'pending'
  },
  payment_status: {
    type: String,
    enum: ['paid', 'unpaid', 'refunded'],
    default: 'unpaid'
  }
}, {
  timestamps: true
});

const blockedSlotSchema = new mongoose.Schema({
  date: {
    type: String,
    required: true
  },
  time_slot: {
    type: String,
    default: null
  },
  reason: {
    type: String,
    default: 'Unavailable'
  },
  blocked_by: {
    type: String,
    default: 'admin'
  },
  is_full_day: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

blockedSlotSchema.index({ date: 1, time_slot: 1 }, { unique: true });
bookingSchema.index({ appointment_time: 1, status: 1 });
bookingSchema.index({ email: 1 });

const User = mongoose.model('User', userSchema);
const Booking = mongoose.model('Booking', bookingSchema);
const BlockedSlot = mongoose.model('BlockedSlot', blockedSlotSchema);

// ================= MAILJET CONFIGURATION =================
const mailjetClient = Mailjet.apiConnect(
  process.env.MAILJET_API_KEY,
  process.env.MAILJET_SECRET_KEY
);

// Verify configuration on startup
if (process.env.MAILJET_API_KEY && process.env.MAILJET_SECRET_KEY) {
  console.log('✅ Mailjet API configured successfully');
  console.log('📧 Sending from:', process.env.MAILJET_FROM_EMAIL);
  console.log('   From name:', process.env.MAILJET_FROM_NAME || 'Chaxx Barbershop');
} else {
  console.warn('⚠️ MAILJET_API_KEY or MAILJET_SECRET_KEY not set - emails will fail');
}

// ================= SEED ADMIN USER =================
async function seedAdminUser() {
  try {
    const adminEmail = 'admin@chaxxbarbers.com';
    const adminPassword = 'admin@chaxxbarbers';
    
    const existingAdmin = await User.findOne({ email: adminEmail });
    
    if (existingAdmin) {
      console.log('Admin user already exists');
      return;
    }
    
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    const adminUser = new User({
      name: 'Admin',
      email: adminEmail,
      password: hashedPassword
    });
    
    await adminUser.save();
    console.log('Admin user created successfully');
    console.log(`Email: ${adminEmail}`);
    console.log(`Password: ${adminPassword}`);
  } catch (error) {
    console.error('Error seeding admin user:', error);
  }
}

// ================= EMAIL TEMPLATES =================
const createConfirmationEmail = (booking) => {
  const formattedDate = new Date(booking.appointment_time).toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  return {
    subject: 'Booking Confirmation - Chaxx Barbershop',
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; }
    h1 { color: #2563eb; }
    .details { background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; }
  </style>
</head>
<body>
  <div class="container">
    <h1>✅ Booking Confirmed!</h1>
    <p>Hi ${booking.customer_name},</p>
    <p>Your appointment at Chaxx Barbershop has been confirmed!</p>
    <div class="details">
      <p><strong>Date & Time:</strong> ${formattedDate}</p>
      <p><strong>Phone:</strong> ${booking.phone_number}</p>
      <p><strong>Payment Status:</strong> ${booking.payment_status}</p>
      <p><strong>Booking ID:</strong> #${booking.id}</p>
    </div>
    <p>We look forward to seeing you!</p>
    <div class="footer">
      <p><strong>Chaxx Barbershop</strong></p>
      <p>📍 5649 Prefontaine Avenue, Regina SK</p>
      <p>📞 +1 (306) 216-7657, +1 (306) 550-6583</p>
    </div>
  </div>
</body>
</html>
`
  };
};

const createAdminNotificationEmail = (bookings) => {
  const isBulk = bookings.length > 1;
  
  const bookingRows = bookings.map(booking => `
    <tr>
      <td><strong>${booking.customer_name}</strong></td>
      <td>${booking.phone_number}</td>
      <td>${booking.email || 'N/A'}</td>
      <td>${new Date(booking.appointment_time).toLocaleString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit'
      })}</td>
      <td>${booking.payment_status}</td>
    </tr>
  `).join('');

  return {
    subject: isBulk ? `New Bulk Booking: ${bookings.length} Appointments` : 'New Booking - Chaxx Barbershop',
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
    .container { max-width: 900px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; }
    h1 { color: #2563eb; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th { background: #2563eb; color: white; padding: 12px; text-align: left; }
    td { padding: 12px; border-bottom: 1px solid #e5e7eb; }
    tr:hover { background: #f9fafb; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔔 New Booking Alert</h1>
    <p>${isBulk ? `${bookings.length} new appointments received` : 'A new appointment has been booked'}</p>
    <table>
      <thead>
        <tr>
          <th>Customer</th>
          <th>Phone</th>
          <th>Email</th>
          <th>Time</th>
          <th>Payment</th>
        </tr>
      </thead>
      <tbody>
        ${bookingRows}
      </tbody>
    </table>
    <p style="color: #6b7280; margin-top: 30px;">Chaxx Barbershop Booking System</p>
  </div>
</body>
</html>
`
  };
};

// ================= EMAIL SENDING FUNCTIONS =================
const sendConfirmationEmail = async (booking) => {
  console.log('\n🔵 sendConfirmationEmail called');
  console.log('   Booking ID:', booking.id);
  console.log('   Email:', booking.email);

  if (!booking.email) {
    console.log('   ⏭️ No email provided');
    return { sent: false, reason: 'No email provided' };
  }

  if (!process.env.MAILJET_API_KEY || !process.env.MAILJET_SECRET_KEY) {
    console.error('   ❌ Mailjet not configured');
    return { sent: false, reason: 'Mailjet not configured' };
  }

  try {
    const emailContent = createConfirmationEmail(booking);
    console.log('   📝 Email content created');
    console.log('   📤 Sending via Mailjet...');
    
    const request = mailjetClient
      .post('send', { version: 'v3.1' })
      .request({
        Messages: [{
          From: {
            Email: process.env.MAILJET_FROM_EMAIL,
            Name: process.env.MAILJET_FROM_NAME || 'Chaxx Barbershop'
          },
          To: [{
            Email: booking.email,
            Name: booking.customer_name
          }],
          Subject: emailContent.subject,
          HTMLPart: emailContent.html
        }]
      });

    const response = await request;
    
    if (response.body?.Messages?.[0]?.Status === 'success') {
      const messageId = response.body.Messages[0].To[0].MessageID;
      console.log('   ✅ Email sent! Message ID:', messageId);
      return { sent: true, messageId, to: booking.email };
    } else {
      console.warn('   ⚠️ Unexpected response:', response.body);
      return { sent: false, reason: 'Unexpected response', response: response.body };
    }
  } catch (error) {
    console.error('   ❌ Email failed:', error.message);
    return { sent: false, error: error.message, to: booking.email };
  }
};

const sendAdminNotificationEmail = async (bookings) => {
  const adminEmail = process.env.ADMIN_EMAIL || 'godson.ihemere@gmail.com';
  
  console.log('\n🔵 sendAdminNotificationEmail called');
  console.log('   Admin email:', adminEmail);
  console.log('   Bookings count:', bookings.length);

  if (!process.env.MAILJET_API_KEY || !process.env.MAILJET_SECRET_KEY) {
    console.error('   ❌ Mailjet not configured');
    return { sent: false, reason: 'Mailjet not configured' };
  }

  try {
    const emailContent = createAdminNotificationEmail(bookings);
    console.log('   📝 Admin email content created');
    console.log('   📤 Sending via Mailjet...');
    
    const request = mailjetClient
      .post('send', { version: 'v3.1' })
      .request({
        Messages: [{
          From: {
            Email: process.env.MAILJET_FROM_EMAIL,
            Name: process.env.MAILJET_FROM_NAME || 'Chaxx Barbershop'
          },
          To: [{
            Email: adminEmail,
            Name: 'Admin'
          }],
          Subject: emailContent.subject,
          HTMLPart: emailContent.html
        }]
      });

    const response = await request;
    
    if (response.body?.Messages?.[0]?.Status === 'success') {
      const messageId = response.body.Messages[0].To[0].MessageID;
      console.log('   ✅ Admin email sent! Message ID:', messageId);
      return { sent: true, messageId, email: adminEmail };
    } else {
      console.warn('   ⚠️ Unexpected response:', response.body);
      return { sent: false, reason: 'Unexpected response', response: response.body };
    }
  } catch (error) {
    console.error('   ❌ Admin email failed:', error.message);
    return { sent: false, error: error.message, email: adminEmail };
  }
};

// ================= HELPER FUNCTION =================
const normalizeToSlotStart = (date) => {
  const normalized = new Date(date);
  normalized.setSeconds(0, 0);
  normalized.setMinutes(Math.floor(normalized.getMinutes() / 30) * 30);
  return normalized;
};

// ================= TEST ENDPOINTS =================
app.get('/test-email', async (req, res) => {
  const testEmail = req.query.email || process.env.ADMIN_EMAIL || 'godson.ihemere@gmail.com';
  
  if (!process.env.MAILJET_API_KEY || !process.env.MAILJET_SECRET_KEY) {
    return res.status(500).json({
      success: false,
      message: 'Mailjet not configured'
    });
  }
  
  try {
    console.log('🧪 Test email to:', testEmail);
    
    const request = mailjetClient
      .post('send', { version: 'v3.1' })
      .request({
        Messages: [{
          From: {
            Email: process.env.MAILJET_FROM_EMAIL,
            Name: 'Chaxx Test'
          },
          To: [{
            Email: testEmail,
            Name: 'Test User'
          }],
          Subject: '✅ Mailjet Working!',
          HTMLPart: '<h1>Test Successful</h1><p>Mailjet is configured correctly!</p>'
        }]
      });

    const response = await request;
    console.log('✅ Test email sent');
    
    res.json({
      success: true,
      message: 'Test email sent!',
      to: testEmail,
      messageId: response.body.Messages[0].To[0].MessageID
    });
  } catch (error) {
    console.error('❌ Test failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/test-direct-email', async (req, res) => {
  const { email, customer_name } = req.body;
  
  console.log('\n🧪 ========== DIRECT EMAIL TEST ==========');
  console.log('Email:', email);
  console.log('Name:', customer_name);
  
  try {
    const testBooking = {
      id: 'TEST_' + Date.now(),
      customer_name: customer_name || 'Test Customer',
      phone_number: '+1234567890',
      email: email,
      appointment_time: new Date(),
      payment_status: 'unpaid'
    };
    
    const result = await sendConfirmationEmail(testBooking);
    
    console.log('Result:', result);
    console.log('✅ ========== TEST COMPLETE ==========\n');
    
    res.json({
      success: true,
      message: 'Direct test completed',
      result: result
    });
  } catch (error) {
    console.error('❌ Direct test error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ================= USERS ENDPOINTS =================
app.get('/users', async (req, res) => {
  try {
    const users = await User.find({}, { password: 0 });
    res.json({ success: true, users });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ success: false, message: 'Server error occurred' });
  }
});

app.post('/users', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name) {
    return res.status(400).json({ success: false, message: 'Name is required' });
  }

  try {
    const userData = { name };
    
    if (email) userData.email = email;
    if (password) userData.password = await bcrypt.hash(password, 10);
    
    const user = new User(userData);
    await user.save();
    
    res.json({
      success: true,
      message: 'User created',
      user: { 
        id: user._id, 
        name: user.name,
        email: user.email || null
      }
    });
  } catch (error) {
    console.error('Error creating user:', error);
    
    if (error.code === 11000) {
      return res.status(409).json({ 
        success: false, 
        message: 'Email already exists' 
      });
    }
    
    res.status(500).json({ success: false, message: 'Server error occurred' });
  }
});

// ================= LOGIN ENDPOINT =================
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Email and password are required'
    });
  }

  try {
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const userObject = user.toObject();
    delete userObject.password;

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token_type: 'Bearer',
        token: crypto.randomBytes(32).toString('hex'),
        user: {
          ...userObject,
          id: user._id
        }
      }
    });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ success: false, message: 'Server error occurred' });
  }
});

// ================= BOOKINGS ENDPOINTS =================
app.get('/bookings', async (req, res) => {
  try {
    const bookings = await Booking.find({}).sort({ appointment_time: -1 });
    res.json({ success: true, bookings });
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ success: false, message: 'Server error occurred' });
  }
});

app.get('/available-slots', async (req, res) => {
  const { date } = req.query;

  if (!date) {
    return res.status(400).json({
      success: false,
      message: 'Date is required as query parameter (?date=YYYY-MM-DD)'
    });
  }

  try {
    const to12Hour = (hour, minute) => {
      const period = hour >= 12 ? 'PM' : 'AM';
      const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
      const displayMinute = minute.toString().padStart(2, '0');
      return `${displayHour}:${displayMinute} ${period}`;
    };

    const dateObj = new Date(date);
    const dayOfWeek = dateObj.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    
    const startHour = 9;
    const endHour = isWeekend ? 20 : 18;
    
    const allSlots = [];
    for (let hour = startHour; hour < endHour; hour++) {
      allSlots.push(to12Hour(hour, 0));
      allSlots.push(to12Hour(hour, 30));
    }

    const fullDayBlock = await BlockedSlot.findOne({
      date: date,
      is_full_day: true
    });

    if (fullDayBlock) {
      return res.json({
        success: true,
        date,
        day_type: isWeekend ? 'weekend' : 'weekday',
        available_slots: [],
        booked_slots: [],
        blocked_slots: allSlots,
        blocked_reason: fullDayBlock.reason,
        is_full_day_blocked: true,
        total_slots: allSlots.length,
        available_count: 0
      });
    }

    const blockedSlots = await BlockedSlot.find({
      date: date,
      is_full_day: false
    });

    const blockedTimes = blockedSlots.map(block => block.time_slot);

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const bookings = await Booking.find({
      appointment_time: {
        $gte: startOfDay,
        $lte: endOfDay
      },
      status: { $ne: 'cancelled' }
    });

    const bookedSlots = bookings.map(booking => {
      const time = new Date(booking.appointment_time);
      const hour = time.getHours();
      const minute = time.getMinutes();
      return to12Hour(hour, minute);
    });

    const availableSlots = allSlots.filter(slot => 
      !bookedSlots.includes(slot) && !blockedTimes.includes(slot)
    );

    res.json({
      success: true,
      date,
      day_type: isWeekend ? 'weekend' : 'weekday',
      available_slots: availableSlots,
      booked_slots: bookedSlots,
      blocked_slots: blockedTimes,
      is_full_day_blocked: false,
      total_slots: allSlots.length,
      available_count: availableSlots.length
    });
  } catch (error) {
    console.error('Error fetching available slots:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error occurred',
      error: error.message 
    });
  }
});

app.post('/bookings', async (req, res) => {
  console.log('\n🟢 ========== NEW BOOKING REQUEST ==========');
  console.log('Request body:', JSON.stringify(req.body, null, 2));
  
  try {
    const isBulkBooking = Array.isArray(req.body);
    const bookingsData = isBulkBooking ? req.body : [req.body];
    console.log(`Processing ${bookingsData.length} booking(s)`);

    // STEP 1: VALIDATION
    console.log('\n📋 Step 1: Validating...');
    const validationErrors = [];
    const validBookings = [];
    
    for (let i = 0; i < bookingsData.length; i++) {
      const booking = bookingsData[i];
      const errors = [];

      if (!booking.customer_name) errors.push('customer_name');
      if (!booking.phone_number) errors.push('phone_number');
      if (!booking.appointment_time) errors.push('appointment_time');

      if (errors.length > 0) {
        validationErrors.push({
          index: i,
          customer_name: booking.customer_name || 'Unknown',
          message: 'Missing required fields',
          missing_fields: errors
        });
        continue;
      }

      const appointmentDate = new Date(booking.appointment_time);
      if (isNaN(appointmentDate.getTime())) {
        validationErrors.push({
          index: i,
          customer_name: booking.customer_name,
          message: 'Invalid appointment_time format',
          provided: booking.appointment_time
        });
        continue;
      }

      if (appointmentDate < new Date()) {
        validationErrors.push({
          index: i,
          customer_name: booking.customer_name,
          message: 'Appointment time cannot be in the past',
          provided: booking.appointment_time
        });
        continue;
      }

      validBookings.push({ ...booking, index: i, appointmentDate });
    }
    
    console.log(`   Valid: ${validBookings.length}, Invalid: ${validationErrors.length}`);

    if (validationErrors.length === bookingsData.length) {
      return res.status(400).json({
        success: false,
        message: `Validation failed for all ${validationErrors.length} booking(s)`,
        errors: validationErrors
      });
    }

    // STEP 2: CONFLICT CHECK
    console.log('\n🔍 Step 2: Checking conflicts...');
    const timeSlotMap = new Map();
    
    validBookings.forEach(booking => {
      const normalizedTime = normalizeToSlotStart(booking.appointmentDate);
      const timeKey = normalizedTime.getTime();
      
      if (!timeSlotMap.has(timeKey)) {
        timeSlotMap.set(timeKey, []);
      }
      timeSlotMap.get(timeKey).push(booking);
    });

    const timeSlots = Array.from(timeSlotMap.keys()).map(t => new Date(t));
    
    const existingBookings = await Booking.find({
      appointment_time: { $in: timeSlots },
      status: { $ne: 'cancelled' }
    }).lean();

    const bookedTimeSlots = new Set(
      existingBookings.map(b => new Date(b.appointment_time).getTime())
    );

    const conflicts = [];
    const bookingsToCreate = [];

    validBookings.forEach(booking => {
      const normalizedTime = normalizeToSlotStart(booking.appointmentDate);
      const timeKey = normalizedTime.getTime();

      if (bookedTimeSlots.has(timeKey)) {
        conflicts.push({
          index: booking.index,
          customer_name: booking.customer_name,
          message: 'Time slot already booked'
        });
      } else {
        bookingsToCreate.push({
          customer_name: booking.customer_name,
          phone_number: booking.phone_number,
          email: booking.email || null,
          appointment_time: normalizedTime,
          status: 'pending',
          payment_status: booking.pay_now ? 'paid' : 'unpaid'
        });
        bookedTimeSlots.add(timeKey);
      }
    });
    
    console.log(`   To create: ${bookingsToCreate.length}, Conflicts: ${conflicts.length}`);

    if (bookingsToCreate.length === 0) {
      return res.status(409).json({
        success: false,
        message: 'All time slots unavailable',
        conflicts: [...validationErrors, ...conflicts]
      });
    }

    // STEP 3: INSERT BOOKINGS
    console.log('\n💾 Step 3: Inserting bookings...');
    const createdBookings = await Booking.insertMany(bookingsToCreate, { ordered: false });
    console.log(`   ✅ Inserted ${createdBookings.length} bookings`);

    const results = createdBookings.map(booking => ({
      id: booking._id,
      customer_name: booking.customer_name,
      phone_number: booking.phone_number,
      email: booking.email,
      appointment_time: booking.appointment_time,
      status: booking.status,
      payment_status: booking.payment_status
    }));

    // STEP 4: SEND EMAILS
    console.log('\n📧 ========== SENDING EMAILS ==========');
    console.log(`Total bookings: ${createdBookings.length}`);
    console.log(`With emails: ${createdBookings.filter(b => b.email).length}`);
    
    const emailResults = {
      customer_emails: [],
      admin_email: null
    };

    // Customer emails
    for (const booking of createdBookings) {
      if (booking.email) {
        console.log(`\n📤 Sending to: ${booking.email}`);
        const result = await sendConfirmationEmail({
          id: booking._id,
          customer_name: booking.customer_name,
          phone_number: booking.phone_number,
          email: booking.email,
          appointment_time: booking.appointment_time,
          payment_status: booking.payment_status
        });
        emailResults.customer_emails.push(result);
      }
    }

    // Admin email
    console.log('\n📤 Sending admin notification...');
    const adminResult = await sendAdminNotificationEmail(results);
    emailResults.admin_email = adminResult;

    console.log('\n✅ ========== EMAILS COMPLETE ==========\n');

    // STEP 5: RESPONSE
    const allErrors = [...validationErrors, ...conflicts];

    if (isBulkBooking && allErrors.length > 0) {
      return res.status(207).json({
        success: true,
        message: `Partial success: ${results.length} created, ${allErrors.length} failed`,
        bookings: results,
        conflicts: allErrors,
        email_results: emailResults,
        summary: {
          total: bookingsData.length,
          successful: results.length,
          failed: allErrors.length,
          emails_sent: emailResults.customer_emails.filter(e => e.sent).length,
          admin_notified: emailResults.admin_email?.sent || false
        }
      });
    }

    if (isBulkBooking) {
      return res.status(201).json({
        success: true,
        message: `Successfully created ${results.length} booking(s)`,
        bookings: results,
        email_results: emailResults,
        summary: {
          total: bookingsData.length,
          successful: results.length,
          failed: 0,
          emails_sent: emailResults.customer_emails.filter(e => e.sent).length,
          admin_notified: emailResults.admin_email?.sent || false
        }
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      booking: results[0],
      email_sent: emailResults.customer_emails[0]?.sent || false,
      admin_notified: emailResults.admin_email?.sent || false,
      email_details: emailResults
    });

  } catch (error) {
    console.error('❌ Error creating booking:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        success: false, 
        message: 'Database validation error',
        details: error.message
      });
    }

    if (error.code === 11000) {
      return res.status(409).json({ 
        success: false, 
        message: 'Duplicate booking detected',
        details: 'A booking with this information already exists'
      });
    }

    res.status(500).json({ 
      success: false, 
      message: 'An unexpected error occurred',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ================= BLOCKED SLOTS ENDPOINTS =================
app.post('/admin/block-slot', async (req, res) => {
  const { date, time_slot, reason, is_full_day } = req.body;

  if (!date) {
    return res.status(400).json({
      success: false,
      message: 'Date is required'
    });
  }

  try {
    const blockData = {
      date,
      time_slot: is_full_day ? null : time_slot,
      reason: reason || 'Unavailable',
      is_full_day: is_full_day || false
    };

    const blockedSlot = await BlockedSlot.create(blockData);

    res.json({
      success: true,
      message: is_full_day ? 'Entire day blocked successfully' : 'Time slot blocked successfully',
      blocked_slot: blockedSlot
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'This slot is already blocked'
      });
    }
    console.error('Error blocking slot:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred',
      error: error.message
    });
  }
});

app.delete('/admin/unblock-slot', async (req, res) => {
  const { date, time_slot, is_full_day } = req.body;

  if (!date) {
    return res.status(400).json({
      success: false,
      message: 'Date is required'
    });
  }

  try {
    const query = { date };
    
    if (is_full_day) {
      query.is_full_day = true;
    } else if (time_slot) {
      query.time_slot = time_slot;
    }

    const result = await BlockedSlot.deleteOne(query);

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Blocked slot not found'
      });
    }

    res.json({
      success: true,
      message: 'Slot unblocked successfully'
    });
  } catch (error) {
    console.error('Error unblocking slot:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred',
      error: error.message
    });
  }
});

app.get('/admin/blocked-slots', async (req, res) => {
  const { date, start_date, end_date } = req.query;

  try {
    let query = {};

    if (date) {
      query.date = date;
    } else if (start_date && end_date) {
      query.date = {
        $gte: start_date,
        $lte: end_date
      };
    }

    const blockedSlots = await BlockedSlot.find(query).sort({ date: 1, time_slot: 1 });

    res.json({
      success: true,
      blocked_slots: blockedSlots,
      count: blockedSlots.length
    });
  } catch (error) {
    console.error('Error fetching blocked slots:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred',
      error: error.message
    });
  }
});

// ================= 404 HANDLER =================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    requested: req.path
  });
});

// ================= ERROR HANDLER =================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

// ================= START SERVER =================
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;