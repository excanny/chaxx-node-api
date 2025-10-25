const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const cors = require('cors');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB configuration
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://excanny:Excannyg*1914@cluster0.rhoaa.mongodb.net/chaxx?retryWrites=true&w=majority';
//const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test';


// Connect to MongoDB
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected successfully');
    seedAdminUser(); // Seed admin user after connection
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
    type: String, // Format: YYYY-MM-DD
    required: true
  },
  time_slot: {
    type: String, // Format: "9:00 AM", "1:30 PM", or null for entire day
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

// Compound index to prevent duplicate blocks
blockedSlotSchema.index({ date: 1, time_slot: 1 }, { unique: true });


// Indexes
bookingSchema.index({ appointment_time: 1 });
bookingSchema.index({ status: 1 });

const User = mongoose.model('User', userSchema);
const Booking = mongoose.model('Booking', bookingSchema);
const BlockedSlot = mongoose.model('BlockedSlot', blockedSlotSchema);

// ================= SEED ADMIN USER =================
async function seedAdminUser() {
  try {
    const adminEmail = 'admin@chaxxbarbers.com';
    const adminPassword = 'admin@chaxxbarbers';
    
    // Check if admin user already exists
    const existingAdmin = await User.findOne({ email: adminEmail });
    
    if (existingAdmin) {
      console.log('Admin user already exists');
      return;
    }
    
    // Create admin user
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

    // Convert to object and remove password
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
    // Helper function to convert 24hr to 12hr format with AM/PM
    const to12Hour = (hour, minute) => {
      const period = hour >= 12 ? 'PM' : 'AM';
      const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
      const displayMinute = minute.toString().padStart(2, '0');
      return `${displayHour}:${displayMinute} ${period}`;
    };

    // Generate 30-minute slots matching frontend logic
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

    // Check if entire day is blocked
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

    // Get blocked time slots for this date
    const blockedSlots = await BlockedSlot.find({
      date: date,
      is_full_day: false
    });

    const blockedTimes = blockedSlots.map(block => block.time_slot);

    // Create date range for the entire day
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // Fetch all bookings for this date
    const bookings = await Booking.find({
      appointment_time: {
        $gte: startOfDay,
        $lte: endOfDay
      },
      status: { $ne: 'cancelled' }
    });

    // Extract booked time slots (HH:MM format)
    const bookedSlots = bookings.map(booking => {
      const time = new Date(booking.appointment_time);
      const hour = time.getHours();
      const minute = time.getMinutes();
      return to12Hour(hour, minute);
    });

    // Filter out booked AND blocked slots
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


// Configure Gmail SMTP transporter with environment variables
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER, // Your Gmail address from .env
    pass: process.env.GMAIL_APP_PASSWORD // Gmail App Password from .env
  }
});

// Verify transporter configuration on startup
transporter.verify((error, success) => {
  if (error) {
    console.error('Email transporter configuration error:', error);
  } else {
    console.log('Email server is ready to send messages');
  }
});

// Email template function for customer
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
    subject: 'Booking Confirmation',
    html: `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      body { 
        font-family: 'Comic Sans MS', 'Chalkboard SE', 'Comic Neue', cursive, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        margin: 0;
        padding: 0;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 25%, #f093fb 50%, #4facfe 75%, #00f2fe 100%);
        background-size: 400% 400%;
        animation: gradientShift 15s ease infinite;
      }
      @keyframes gradientShift {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }
      .email-wrapper {
        padding: 40px 20px;
      }
      .container { 
        max-width: 600px; 
        margin: 0 auto; 
        background-color: #ffffff;
        border-radius: 30px;
        overflow: hidden;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        border: 6px solid #fbbf24;
        transform: rotate(-1deg);
      }
      .container-inner {
        transform: rotate(1deg);
      }
      .header { 
        background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
        padding: 40px 30px;
        text-align: center;
        position: relative;
        overflow: hidden;
      }
      .confetti {
        position: absolute;
        width: 100%;
        height: 100%;
        top: 0;
        left: 0;
        pointer-events: none;
      }
      .confetti span {
        position: absolute;
        font-size: 24px;
        animation: fall 3s linear infinite;
      }
      .confetti span:nth-child(1) { left: 10%; animation-delay: 0s; }
      .confetti span:nth-child(2) { left: 25%; animation-delay: 0.5s; }
      .confetti span:nth-child(3) { left: 40%; animation-delay: 1s; }
      .confetti span:nth-child(4) { left: 55%; animation-delay: 1.5s; }
      .confetti span:nth-child(5) { left: 70%; animation-delay: 2s; }
      .confetti span:nth-child(6) { left: 85%; animation-delay: 2.5s; }
      @keyframes fall {
        0% { top: -10%; transform: rotate(0deg); }
        100% { top: 110%; transform: rotate(360deg); }
      }
      .party-icon {
        font-size: 80px;
        margin-bottom: 10px;
        display: inline-block;
        animation: bounce 1s ease infinite;
      }
      @keyframes bounce {
        0%, 100% { transform: translateY(0) rotate(-5deg); }
        50% { transform: translateY(-20px) rotate(5deg); }
      }
      .header h1 { 
        margin: 0; 
        font-size: 42px;
        font-weight: 900;
        color: #7c2d12;
        text-transform: uppercase;
        letter-spacing: 2px;
        text-shadow: 3px 3px 0px #fef3c7;
        position: relative;
        z-index: 1;
      }
      .header p {
        margin: 15px 0 0 0;
        font-size: 20px;
        color: #92400e;
        font-weight: 700;
        position: relative;
        z-index: 1;
      }
      .content { 
        padding: 40px 35px;
        background-color: #ffffff;
      }
      .greeting {
        font-size: 26px;
        color: #7c3aed;
        margin-bottom: 12px;
        font-weight: 900;
      }
      .message {
        font-size: 17px;
        color: #1f2937;
        margin-bottom: 35px;
        line-height: 1.7;
        font-weight: 600;
      }
      .fun-banner {
        background: linear-gradient(135deg, #fde68a 0%, #fbbf24 100%);
        padding: 20px;
        border-radius: 20px;
        text-align: center;
        margin-bottom: 30px;
        border: 4px dashed #f59e0b;
        transform: rotate(-1deg);
      }
      .fun-banner p {
        margin: 0;
        font-size: 18px;
        color: #78350f;
        font-weight: 900;
      }
      .details-card {
        background: linear-gradient(135deg, #ddd6fe 0%, #c4b5fd 100%);
        border-radius: 25px;
        padding: 30px;
        margin: 25px 0;
        border: 5px solid #7c3aed;
        box-shadow: 8px 8px 0px #a78bfa;
        position: relative;
      }
      .sticker {
        position: absolute;
        font-size: 50px;
        transform: rotate(15deg);
      }
      .sticker-1 { top: -20px; right: -15px; }
      .sticker-2 { bottom: -20px; left: -15px; transform: rotate(-20deg); }
      .detail-item { 
        display: flex;
        align-items: center;
        margin: 20px 0;
        padding: 18px;
        background-color: rgba(255, 255, 255, 0.9);
        border-radius: 15px;
        border: 3px solid #a78bfa;
        transform: rotate(-0.5deg);
      }
      .detail-item:nth-child(even) {
        transform: rotate(0.5deg);
      }
      .detail-emoji {
        font-size: 32px;
        margin-right: 15px;
        animation: wiggle 2s ease-in-out infinite;
      }
      @keyframes wiggle {
        0%, 100% { transform: rotate(-5deg); }
        50% { transform: rotate(5deg); }
      }
      .detail-info {
        flex: 1;
      }
      .label { 
        font-size: 13px;
        color: #5b21b6;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 1px;
        display: block;
        margin-bottom: 5px;
      }
      .value {
        font-size: 16px;
        color: #1f2937;
        font-weight: 700;
      }
      .payment-badge {
        display: inline-block;
        padding: 8px 18px;
        border-radius: 20px;
        font-size: 14px;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 1px;
        transform: rotate(-3deg);
      }
      .payment-paid {
        background: linear-gradient(135deg, #34d399 0%, #10b981 100%);
        color: #ffffff;
        box-shadow: 4px 4px 0px #059669;
      }
      .payment-unpaid {
        background: linear-gradient(135deg, #fb923c 0%, #f97316 100%);
        color: #ffffff;
        box-shadow: 4px 4px 0px #ea580c;
      }
      .booking-id {
        font-family: 'Courier New', monospace;
        font-size: 15px;
        color: #1f2937;
        font-weight: 900;
        background-color: #fef3c7;
        padding: 5px 12px;
        border-radius: 8px;
        border: 2px solid #fbbf24;
      }
      .action-section {
        text-align: center;
        margin: 40px 0;
      }
      .button {
        display: inline-block;
        background: linear-gradient(135deg, #ec4899 0%, #db2777 100%);
        color: #ffffff;
        padding: 18px 45px;
        text-decoration: none;
        border-radius: 50px;
        font-weight: 900;
        font-size: 18px;
        text-transform: uppercase;
        letter-spacing: 1px;
        box-shadow: 6px 6px 0px #be185d;
        border: 4px solid #ffffff;
        transition: transform 0.2s;
        animation: pulse 2s ease-in-out infinite;
      }
      @keyframes pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.05); }
      }
      .speech-bubble {
        background-color: #fef3c7;
        border: 4px solid #fbbf24;
        border-radius: 20px;
        padding: 20px;
        margin: 30px 0;
        position: relative;
        text-align: center;
      }
      .speech-bubble::after {
        content: '';
        position: absolute;
        bottom: -20px;
        left: 50%;
        transform: translateX(-50%);
        width: 0;
        height: 0;
        border-left: 20px solid transparent;
        border-right: 20px solid transparent;
        border-top: 20px solid #fbbf24;
      }
      .speech-bubble p {
        margin: 0;
        font-size: 16px;
        color: #78350f;
        font-weight: 800;
      }
      .footer { 
        background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%);
        padding: 35px; 
        text-align: center;
        color: #ffffff;
      }
      .footer-brand {
        font-size: 28px;
        font-weight: 900;
        margin-bottom: 10px;
        text-transform: uppercase;
        letter-spacing: 2px;
        text-shadow: 3px 3px 0px rgba(0, 0, 0, 0.2);
      }
      .footer-text {
        font-size: 14px;
        margin: 8px 0;
        font-weight: 600;
        opacity: 0.95;
      }
      .wave {
        display: inline-block;
        animation: wave 1s ease-in-out infinite;
      }
      @keyframes wave {
        0%, 100% { transform: rotate(0deg); }
        25% { transform: rotate(20deg); }
        75% { transform: rotate(-20deg); }
      }
    </style>
  </head>
  <body>
    <div class="email-wrapper">
      <div class="container">
        <div class="container-inner">
          <div class="header">
            <h1>✂️ YOU'RE IN!</h1>
            <p>Your Booking is Confirmed 🎉</p>
          </div>
          
          <div class="content">
            <p class="greeting">Hey ${booking.customer_name}! <span class="wave">👋</span></p>
            <p class="message">
              Get ready to look AMAZING! Your appointment at <strong>Chaxx Barbershop</strong> 
              is confirmed and we're pumped to see you! ✂️✨
            </p>
            
            <div class="fun-banner">
              <p>🎊 Your Fresh Cut Adventure Starts Soon! 🎊</p>
            </div>
            
            <div class="details-card">
              <div class="detail-item">
                <div class="detail-emoji">📅</div>
                <div class="detail-info">
                  <span class="label">When's the magic?</span>
                  <div class="value">${formattedDate}</div>
                </div>
              </div>
              
              <div class="detail-item">
                <div class="detail-emoji">📱</div>
                <div class="detail-info">
                  <span class="label">Ring Ring!</span>
                  <div class="value">${booking.phone_number}</div>
                </div>
              </div>
              
              <div class="detail-item">
                <div class="detail-emoji">💰</div>
                <div class="detail-info">
                  <span class="label">Payment Status</span>
                  <div class="value">
                    <span class="payment-badge payment-${booking.payment_status}">
                      ${booking.payment_status === 'paid' ? '✓ ALL PAID!' : '⏳ PENDING'}
                    </span>
                  </div>
                </div>
              </div>
              
              <div class="detail-item">
                <div class="detail-emoji">🎫</div>
                <div class="detail-info">
                  <span class="label">Your Golden Ticket</span>
                  <div class="value">
                    <span class="booking-id">#${booking.id}</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="speech-bubble">
              <p>💡 Pro Tip: Come 5 mins early and you'll be our favorite person! 😎</p>
            </div>


            <p style="text-align: center; color: #6b7280; font-size: 15px; margin-top: 30px; font-weight: 700;">
              Questions? We're here! Give us a shout anytime! 📞💬
            </p>
          </div>
          
          <div class="footer">
            <div class="footer-brand">✂️ CHAXX BARBERSHOP ✂️</div>
            <p class="footer-text">Where Every Cut is a Masterpiece! 🎨</p>
            <p class="footer-text">📍 5649 Prefontaine Avenue, Regina SK</p>
            <p class="footer-text">📞 +1 (306) 216-7657, +1 (306) 550-6583 | ✉️ <span style="color: #fff;">hello@chaxxbarbershop.com</span></p>
            <p class="footer-text" style="margin-top: 20px; font-size: 12px; opacity: 0.9;">
              Spreading good vibes, one cut at a time.! 🎉
            </p>
          </div>
        </div>
      </div>
    </div>
  </body>
  </html>
`
  };
};

// Email template function for admin
const createAdminNotificationEmail = (bookings) => {
  const isBulk = bookings.length > 1;
  
const bookingRows = bookings.map(booking => `
  <tr>
    <td><strong>${booking.customer_name}</strong></td>
    <td>${booking.phone_number}</td>
    <td>${booking.email}</td>
    <td>${new Date(booking.appointment_time).toLocaleString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      hour: '2-digit', 
      minute: '2-digit'
    })}</td>
    <td><span class="badge badge-${booking.payment_status}">${booking.payment_status}</span></td>
    <td><span class="booking-id">${booking.id}</span></td>
  </tr>
`).join('');

  return {
    subject: isBulk ? `New Bulk Booking: ${bookings.length} Appointments` : 'New Booking Received',
  html: `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      body { 
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        line-height: 1.6; 
        color: #1f2937; 
        margin: 0;
        padding: 0;
        background-color: #f3f4f6;
      }
      .email-wrapper {
        padding: 30px 15px;
      }
      .container { 
        max-width: 900px; 
        margin: 0 auto; 
        background-color: #ffffff;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07);
      }
      .header { 
        background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%);
        color: white; 
        padding: 30px;
        text-align: center;
      }
      .header h1 { 
        margin: 0 0 8px 0; 
        font-size: 28px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
      }
      .bell-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        background-color: rgba(255, 255, 255, 0.2);
        border-radius: 50%;
        font-size: 20px;
        animation: ring 2s ease-in-out infinite;
      }
      @keyframes ring {
        0%, 100% { transform: rotate(0deg); }
        10%, 30% { transform: rotate(-10deg); }
        20%, 40% { transform: rotate(10deg); }
      }
      .subtitle {
        margin: 0;
        font-size: 15px;
        opacity: 0.95;
        font-weight: 500;
      }
      .content { 
        padding: 30px;
      }
      .stats-grid {
        display: table;
        width: 100%;
        margin-bottom: 30px;
        border-spacing: 15px 0;
      }
      .stat-card {
        display: table-cell;
        background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
        padding: 20px;
        border-radius: 10px;
        text-align: center;
        width: 33.33%;
      }
      .stat-card.paid {
        background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%);
      }
      .stat-card.unpaid {
        background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
      }
      .stat-number {
        font-size: 32px;
        font-weight: 700;
        color: #1e40af;
        margin: 0 0 5px 0;
      }
      .stat-card.paid .stat-number {
        color: #15803d;
      }
      .stat-card.unpaid .stat-number {
        color: #b45309;
      }
      .stat-label {
        font-size: 13px;
        color: #6b7280;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin: 0;
      }
      .section-title {
        font-size: 18px;
        font-weight: 700;
        color: #111827;
        margin: 0 0 20px 0;
        padding-bottom: 10px;
        border-bottom: 2px solid #e5e7eb;
      }
      .table-wrapper {
        overflow-x: auto;
        border-radius: 8px;
        border: 1px solid #e5e7eb;
      }
      table { 
        width: 100%; 
        border-collapse: collapse; 
        background-color: white;
      }
      th { 
        background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%);
        color: white; 
        padding: 14px 12px; 
        text-align: left;
        font-size: 13px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      td { 
        padding: 14px 12px; 
        border-bottom: 1px solid #f3f4f6;
        font-size: 14px;
      }
      tr:last-child td {
        border-bottom: none;
      }
      tr:hover {
        background-color: #f9fafb;
      }
      .badge {
        display: inline-block;
        padding: 4px 10px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
      }
      .badge-paid {
        background-color: #d1fae5;
        color: #065f46;
      }
      .badge-unpaid {
        background-color: #fef3c7;
        color: #92400e;
      }
      .booking-id {
        font-family: 'Courier New', monospace;
        background-color: #f3f4f6;
        padding: 3px 8px;
        border-radius: 4px;
        font-size: 12px;
        color: #4b5563;
      }
      .footer { 
        background-color: #f9fafb;
        padding: 25px 30px; 
        text-align: center; 
        border-top: 1px solid #e5e7eb;
      }
      .footer-title {
        font-size: 14px;
        color: #374151;
        margin: 0 0 8px 0;
        font-weight: 600;
      }
      .footer-text {
        font-size: 13px;
        color: #6b7280;
        margin: 5px 0;
      }
      .timestamp {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background-color: #e0f2fe;
        padding: 8px 16px;
        border-radius: 6px;
        font-size: 13px;
        color: #0c4a6e;
        font-weight: 500;
        margin-top: 10px;
      }
        .text-white { color: white; }
    </style>
  </head>
  <body>
    <div class="email-wrapper">
      <div class="container">
        <div class="header">
          <h1>
            <span class="bell-icon">🔔</span>
            New Booking Alert
          </h1>
          <p class="subtitle">${isBulk ? `${bookings.length} new appointments received` : 'A new appointment has been booked'}</p>
        </div>
        
        <div class="content">
          <div class="stats-grid">
            <div class="stat-card">
              <p class="stat-number">${isBulk ? bookings.length : 1}</p>
              <p class="stat-label">Total Bookings</p>
            </div>
            <div class="stat-card paid">
              <p class="stat-number">${bookings.filter(b => b.payment_status === 'paid').length}</p>
              <p class="stat-label">Paid</p>
            </div>
            <div class="stat-card unpaid">
              <p class="stat-number">${bookings.filter(b => b.payment_status === 'unpaid').length}</p>
              <p class="stat-label">Unpaid</p>
            </div>
          </div>
          
          <h3 class="section-title">📋 Booking Details</h3>
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>Appointment</th>
                  <th>Payment</th>
                  <th>ID</th>
                </tr>
              </thead>
              <tbody>
                ${bookingRows}
              </tbody>
            </table>
          </div>
        </div>
        
        <div class="footer">
          <p class="footer-title">Chaxx Barbershop Booking System</p>
          <p class="footer-text">Automated notification • Do not reply to this email</p>
          <div class="timestamp">
            <span>🕐</span>
            <span>${new Date().toLocaleString('en-US', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric', 
              hour: '2-digit', 
              minute: '2-digit' 
            })}</span>
          </div>
        </div>
      </div>
    </div>
  </body>
  </html>
`
  };
};

// Function to send customer confirmation email
const sendConfirmationEmail = async (booking) => {
  if (!booking.email) {
    console.log(`No email provided for booking ${booking.id}`);
    return { sent: false, reason: 'No email provided' };
  }

  const emailContent = createConfirmationEmail(booking);

  try {
    await transporter.sendMail({
      from: `"Chaxx Barbershop Booking System" <${process.env.GMAIL_USER}>`,
      to: booking.email,
      subject: emailContent.subject,
      html: emailContent.html
    });

    console.log(`Confirmation email sent to ${booking.email}`);
    return { sent: true };
  } catch (error) {
    console.error(`Failed to send email to ${booking.email}:`, error);
    return { sent: false, error: error.message };
  }
};

// Function to send admin notification email
const sendAdminNotificationEmail = async (bookings) => {
  const adminEmail = process.env.ADMIN_EMAIL || 'godson.ihemere@gmail.com';
  const emailContent = createAdminNotificationEmail(bookings);

  try {
    await transporter.sendMail({
      from: `"Chaxx Barbershop Booking System" <${process.env.GMAIL_USER}>`,
      to: adminEmail,
      subject: emailContent.subject,
      html: emailContent.html
    });

    console.log(`Admin notification sent to ${adminEmail} for ${bookings.length} booking(s)`);
    return { sent: true, email: adminEmail };
  } catch (error) {
    console.error(`Failed to send admin notification to ${adminEmail}:`, error);
    return { sent: false, error: error.message, email: adminEmail };
  }
};

// app.post('/bookings', async (req, res) => {
//   try {
//     // Check if it's a bulk booking request
//     const isBulkBooking = Array.isArray(req.body);
//     const bookingsData = isBulkBooking ? req.body : [req.body];

//     // Validate all bookings first
//     const validationErrors = [];
//     bookingsData.forEach((booking, index) => {
//       if (!booking.customer_name || !booking.phone_number || !booking.appointment_time) {
//         validationErrors.push({
//           index,
//           customer_name: booking.customer_name || 'Unknown',
//           message: 'Missing required fields',
//           missing_fields: [
//             !booking.customer_name && 'customer_name',
//             !booking.phone_number && 'phone_number',
//             !booking.appointment_time && 'appointment_time'
//           ].filter(Boolean)
//         });
//       }
      
//       // Validate appointment_time format
//       if (booking.appointment_time) {
//         const appointmentDate = new Date(booking.appointment_time);
//         if (isNaN(appointmentDate.getTime())) {
//           validationErrors.push({
//             index,
//             customer_name: booking.customer_name || 'Unknown',
//             message: 'Invalid appointment_time format',
//             provided: booking.appointment_time
//           });
//         } else if (appointmentDate < new Date()) {
//           validationErrors.push({
//             index,
//             customer_name: booking.customer_name || 'Unknown',
//             message: 'Appointment time cannot be in the past',
//             provided: booking.appointment_time
//           });
//         }
//       }
      
//       // Validate pay_now is boolean if provided
//       if (booking.pay_now !== undefined && typeof booking.pay_now !== 'boolean') {
//         validationErrors.push({
//           index,
//           customer_name: booking.customer_name || 'Unknown',
//           message: 'pay_now must be a boolean value (true or false)',
//           provided: booking.pay_now
//         });
//       }

//       // Validate email format if provided
//       if (booking.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(booking.email)) {
//         validationErrors.push({
//           index,
//           customer_name: booking.customer_name || 'Unknown',
//           message: 'Invalid email format',
//           provided: booking.email
//         });
//       }
//     });

//     if (validationErrors.length > 0) {
//       return res.status(400).json({
//         success: false,
//         message: `Validation failed for ${validationErrors.length} booking(s)`,
//         errors: validationErrors,
//         total_requests: bookingsData.length
//       });
//     }

//     // Process bookings
//     const results = [];
//     const conflicts = [];
//     const emailResults = [];

//     for (let i = 0; i < bookingsData.length; i++) {
//       const { 
//         customer_name, 
//         phone_number, 
//         email, 
//         appointment_time,
//         pay_now = false
//       } = bookingsData[i];

//       const appointmentDate = new Date(appointment_time);

//       // Extract date and time for comparison
//       const startOfSlot = new Date(appointmentDate);
//       startOfSlot.setSeconds(0, 0);

//       const endOfSlot = new Date(startOfSlot);
//       endOfSlot.setMinutes(endOfSlot.getMinutes() + 59);
//       endOfSlot.setSeconds(59, 999);

//       // Check availability
//       const existingBooking = await Booking.findOne({
//         appointment_time: {
//           $gte: startOfSlot,
//           $lte: endOfSlot
//         },
//         status: { $ne: 'cancelled' }
//       });

//       if (existingBooking) {
//         // Format the time slot for better readability
//         const formattedTime = appointmentDate.toLocaleString('en-US', {
//           weekday: 'short',
//           year: 'numeric',
//           month: 'short',
//           day: 'numeric',
//           hour: '2-digit',
//           minute: '2-digit',
//           hour12: true
//         });

//         conflicts.push({
//           index: i,
//           customer_name,
//           phone_number,
//           email: email || null,
//           requested_time: appointment_time,
//           formatted_time: formattedTime,
//           message: 'This time slot is already booked',
//           booked_by: {
//             name: existingBooking.customer_name,
//             booking_id: existingBooking._id
//           },
//           suggestion: 'Please select a different time slot or contact us for availability'
//         });
//         continue;
//       }

//       // Create booking with payment status based on pay_now
//       const booking = new Booking({
//         customer_name,
//         phone_number,
//         email: email || null,
//         appointment_time: appointmentDate,
//         status: 'pending',
//         payment_status: pay_now ? 'paid' : 'unpaid'
//       });

//       await booking.save();

//       // Send customer confirmation email
//       const emailResult = await sendConfirmationEmail({
//         id: booking._id,
//         customer_name: booking.customer_name,
//         phone_number: booking.phone_number,
//         email: booking.email,
//         appointment_time: booking.appointment_time,
//         payment_status: booking.payment_status
//       });

//       emailResults.push({
//         booking_id: booking._id,
//         email: booking.email,
//         ...emailResult
//       });

//       results.push({
//         id: booking._id,
//         customer_name: booking.customer_name,
//         phone_number: booking.phone_number,
//         email: booking.email,
//         appointment_time: booking.appointment_time,
//         status: booking.status,
//         payment_status: booking.payment_status,
//         pay_now,
//         email_sent: emailResult.sent
//       });
//     }

//     // Send admin notification if any bookings were successful
//     let adminEmailResult = { sent: false };
//     if (results.length > 0) {
//       adminEmailResult = await sendAdminNotificationEmail(results);
//     }

//     // Handle different response scenarios
    
//     // Scenario 1: All bookings failed due to conflicts
//     if (conflicts.length > 0 && results.length === 0) {
//       return res.status(409).json({ // 409 Conflict is more appropriate than 422
//         success: false,
//         message: isBulkBooking 
//           ? `All ${conflicts.length} time slot(s) are unavailable` 
//           : 'The requested time slot is already booked',
//         conflicts,
//         suggestion: 'Please choose different time slot(s) and try again',
//         total_requests: bookingsData.length,
//         failed: conflicts.length
//       });
//     }

//     // Scenario 2: Partial success (some bookings succeeded, some failed)
//     if (isBulkBooking && conflicts.length > 0 && results.length > 0) {
//       return res.status(207).json({ // 207 Multi-Status
//         success: true,
//         message: `Partial success: ${results.length} booking(s) created, ${conflicts.length} failed`,
//         bookings: results,
//         conflicts,
//         summary: {
//           total: bookingsData.length,
//           successful: results.length,
//           failed: conflicts.length,
//           emails_sent: emailResults.filter(e => e.sent).length,
//           emails_failed: emailResults.filter(e => !e.sent).length,
//           admin_notified: adminEmailResult.sent
//         }
//       });
//     }

//     // Scenario 3: Complete success (bulk)
//     if (isBulkBooking) {
//       return res.status(201).json({
//         success: true,
//         message: `Successfully created ${results.length} booking(s)`,
//         bookings: results,
//         summary: {
//           total: bookingsData.length,
//           successful: results.length,
//           failed: 0,
//           emails_sent: emailResults.filter(e => e.sent).length,
//           emails_failed: emailResults.filter(e => !e.sent).length,
//           admin_notified: adminEmailResult.sent
//         }
//       });
//     }

//     // Scenario 4: Complete success (single booking)
//     return res.status(201).json({
//       success: true,
//       message: 'Booking created successfully',
//       booking: results[0],
//       admin_notified: adminEmailResult.sent
//     });

//   } catch (error) {
//     console.error('Error creating booking:', error);
    
//     // Handle specific error types
//     if (error.name === 'ValidationError') {
//       return res.status(400).json({ 
//         success: false, 
//         message: 'Database validation error',
//         details: error.message
//       });
//     }

//     if (error.name === 'MongoError' && error.code === 11000) {
//       return res.status(409).json({ 
//         success: false, 
//         message: 'Duplicate booking detected',
//         details: 'A booking with this information already exists'
//       });
//     }

//     // Generic error response
//     res.status(500).json({ 
//       success: false, 
//       message: 'An unexpected error occurred while processing your booking',
//       error: process.env.NODE_ENV === 'development' ? error.message : undefined
//     });
//   }
// });

app.post('/bookings', async (req, res) => {
  try {
    // Check if it's a bulk booking request
    const isBulkBooking = Array.isArray(req.body);
    const bookingsData = isBulkBooking ? req.body : [req.body];

    // Validate all bookings first
    const validationErrors = [];
    bookingsData.forEach((booking, index) => {
      if (!booking.customer_name || !booking.phone_number || !booking.appointment_time) {
        validationErrors.push({
          index,
          customer_name: booking.customer_name || 'Unknown',
          message: 'Missing required fields',
          missing_fields: [
            !booking.customer_name && 'customer_name',
            !booking.phone_number && 'phone_number',
            !booking.appointment_time && 'appointment_time'
          ].filter(Boolean)
        });
      }
      
      // Validate appointment_time format
      if (booking.appointment_time) {
        const appointmentDate = new Date(booking.appointment_time);
        if (isNaN(appointmentDate.getTime())) {
          validationErrors.push({
            index,
            customer_name: booking.customer_name || 'Unknown',
            message: 'Invalid appointment_time format',
            provided: booking.appointment_time
          });
        } else if (appointmentDate < new Date()) {
          validationErrors.push({
            index,
            customer_name: booking.customer_name || 'Unknown',
            message: 'Appointment time cannot be in the past',
            provided: booking.appointment_time
          });
        }
      }
      
      // Validate pay_now is boolean if provided
      if (booking.pay_now !== undefined && typeof booking.pay_now !== 'boolean') {
        validationErrors.push({
          index,
          customer_name: booking.customer_name || 'Unknown',
          message: 'pay_now must be a boolean value (true or false)',
          provided: booking.pay_now
        });
      }

      // Validate email format if provided
      if (booking.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(booking.email)) {
        validationErrors.push({
          index,
          customer_name: booking.customer_name || 'Unknown',
          message: 'Invalid email format',
          provided: booking.email
        });
      }
    });

    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Validation failed for ${validationErrors.length} booking(s)`,
        errors: validationErrors,
        total_requests: bookingsData.length
      });
    }

    // Process bookings
    const results = [];
    const conflicts = [];
    const emailResults = [];

    for (let i = 0; i < bookingsData.length; i++) {
      const { 
        customer_name, 
        phone_number, 
        email, 
        appointment_time,
        pay_now = false
      } = bookingsData[i];

      const appointmentDate = new Date(appointment_time);

      // Extract date and time for comparison
      const startOfSlot = new Date(appointmentDate);
      startOfSlot.setSeconds(0, 0);

      const endOfSlot = new Date(startOfSlot);
      endOfSlot.setMinutes(endOfSlot.getMinutes() + 59);
      endOfSlot.setSeconds(59, 999);

      // Check availability
      const existingBooking = await Booking.findOne({
        appointment_time: {
          $gte: startOfSlot,
          $lte: endOfSlot
        },
        status: { $ne: 'cancelled' }
      });

      if (existingBooking) {
        // Format the time slot for better readability
        const formattedTime = appointmentDate.toLocaleString('en-US', {
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });

        conflicts.push({
          index: i,
          customer_name,
          phone_number,
          email: email || null,
          requested_time: appointment_time,
          formatted_time: formattedTime,
          message: 'This time slot is already booked',
          booked_by: {
            name: existingBooking.customer_name,
            booking_id: existingBooking._id
          },
          suggestion: 'Please select a different time slot or contact us for availability'
        });
        continue;
      }

      // Create booking with payment status based on pay_now
      const booking = new Booking({
        customer_name,
        phone_number,
        email: email || null,
        appointment_time: appointmentDate,
        status: 'pending',
        payment_status: pay_now ? 'paid' : 'unpaid'
      });

      await booking.save();

      // Send customer confirmation email
      const emailResult = await sendConfirmationEmail({
        id: booking._id,
        customer_name: booking.customer_name,
        phone_number: booking.phone_number,
        email: booking.email,
        appointment_time: booking.appointment_time,
        payment_status: booking.payment_status
      });

      emailResults.push({
        booking_id: booking._id,
        email: booking.email,
        ...emailResult
      });

      results.push({
        id: booking._id,
        customer_name: booking.customer_name,
        phone_number: booking.phone_number,
        email: booking.email,
        appointment_time: booking.appointment_time,
        status: booking.status,
        payment_status: booking.payment_status,
        pay_now,
        email_sent: emailResult.sent
      });
    }

    // Send admin notification if any bookings were successful
    let adminEmailResult = { sent: false };
    if (results.length > 0) {
      adminEmailResult = await sendAdminNotificationEmail(results);
    }

    // Handle different response scenarios
    
    // Scenario 1: All bookings failed due to conflicts
    if (conflicts.length > 0 && results.length === 0) {
      return res.status(409).json({
        success: false,
        message: isBulkBooking 
          ? `All ${conflicts.length} time slot(s) are unavailable` 
          : 'The requested time slot is already booked',
        conflicts,
        suggestion: 'Please choose different time slot(s) and try again',
        total_requests: bookingsData.length,
        failed: conflicts.length
      });
    }

    // Scenario 2: Partial success (some bookings succeeded, some failed)
    if (isBulkBooking && conflicts.length > 0 && results.length > 0) {
      return res.status(207).json({
        success: true,
        message: `Partial success: ${results.length} booking(s) created, ${conflicts.length} failed`,
        bookings: results,
        conflicts,
        summary: {
          total: bookingsData.length,
          successful: results.length,
          failed: conflicts.length,
          emails_sent: emailResults.filter(e => e.sent).length,
          emails_failed: emailResults.filter(e => !e.sent).length,
          admin_notified: adminEmailResult.sent
        }
      });
    }

    // Scenario 3: Complete success (bulk)
    if (isBulkBooking) {
      return res.status(201).json({
        success: true,
        message: `Successfully created ${results.length} booking(s)`,
        bookings: results,
        summary: {
          total: bookingsData.length,
          successful: results.length,
          failed: 0,
          emails_sent: emailResults.filter(e => e.sent).length,
          emails_failed: emailResults.filter(e => !e.sent).length,
          admin_notified: adminEmailResult.sent
        }
      });
    }

    // Scenario 4: Complete success (single booking)
    // FIXED: Admin notification is now sent before this response
    return res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      booking: results[0],
      email_sent: emailResults[0]?.sent || false,
      admin_notified: adminEmailResult.sent
    });

  } catch (error) {
    console.error('Error creating booking:', error);
    
    // Handle specific error types
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        success: false, 
        message: 'Database validation error',
        details: error.message
      });
    }

    if (error.name === 'MongoError' && error.code === 11000) {
      return res.status(409).json({ 
        success: false, 
        message: 'Duplicate booking detected',
        details: 'A booking with this information already exists'
      });
    }

    // Generic error response
    res.status(500).json({ 
      success: false, 
      message: 'An unexpected error occurred while processing your booking',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

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

// Unblock a specific time slot or entire day
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

// Get all blocked slots
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


app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    requested: req.path,
    uri: req.originalUrl
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

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;