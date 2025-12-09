const express = require('express');
const bodyParser = require('body-parser');
const { Expo } = require('expo-server-sdk');
const { createClient } = require('@sanity/client');
const cors = require('cors');

const app = express();
const expo = new Expo();

app.use(bodyParser.json());
app.use(cors());

// Sanity Client (Token එක අලුත් එකම තියෙන්න ඕන)
const client = createClient({
  projectId: 'p0umau0m',
  dataset: 'production',
  useCdn: false,
  apiVersion: '2023-05-03',
  token: 'skkqogowsBDjKpQP5Vj8K7dGa2PQt9zo8IH2ZAuFVBYPQN1KA61TA0a6DFzeK1rYHjRMYaqVKcYIGixBKOhji8haEteOrwBDgBltybyirZAEyFOuzda5G8Dq7JllntpEakLKER7PYxqdnt1gWmbpwY6Sfcih5pUivas87w7tuCfpz2hynsZe' 
});

// Helper: Notification Send Function
const sendNotifications = async (messages) => {
  let chunks = expo.chunkPushNotifications(messages);
  for (let chunk of chunks) {
    try {
      await expo.sendPushNotificationsAsync(chunk);
      console.log('✅ Notification chunk sent!');
    } catch (error) {
      console.error('❌ Error sending chunk:', error);
    }
  }
};

// --- UNIVERSAL WEBHOOK HANDLER (මේ කොටස තමයි ඔයාට නැත්තේ) ---
app.post('/webhook/all', async (req, res) => {
  const { 
    _type, _id, orderStatus, status, 
    foodTotal, amount, title, message, target, 
    restaurant, rider 
  } = req.body;

  console.log(`🔔 Webhook Received: ${_type} | ID: ${_id}`);

  try {
    // 1. FOOD ORDER LOGIC
    if (_type === 'foodOrder') {
      
      // A. New Order -> Restaurant
      if (orderStatus === 'pending' && restaurant?.pushToken) {
        console.log(`📦 New Order for: ${restaurant.name}`);
        await sendNotifications([{
          to: restaurant.pushToken,
          sound: 'default',
          title: '🔥 New Order Received!',
          body: 'You have a new order waiting for acceptance.',
          data: { orderId: _id, type: 'new_order' },
          channelId: 'default',
        }]);
      }

      // B. Order Completed -> Restaurant
      else if (orderStatus === 'completed' && restaurant?.pushToken) {
        console.log(`✅ Order Completed: ${_id}`);
        await sendNotifications([{
          to: restaurant.pushToken,
          sound: 'default',
          title: 'Order Delivered! 🎉',
          body: `Order #${_id.slice(-4).toUpperCase()} completed. Earnings: LKR ${foodTotal}`,
          data: { orderId: _id, type: 'order_completed' },
          channelId: 'default',
        }]);
      }

      // C. Order Pool (Ready for Pickup) -> Online Riders
      else if (orderStatus === 'readyForPickup') {
        console.log(`📡 Broadcasting to Order Pool: ${_id}`);
        const onlineRiders = await client.fetch(
          `*[_type == "rider" && availability == "online" && defined(pushToken) && !(_id in path("drafts.**"))] { pushToken }`
        );

        if (onlineRiders.length > 0) {
          const messages = onlineRiders.map(r => ({
            to: r.pushToken,
            sound: 'default',
            title: 'New Order Available! 🚀',
            body: `New order from ${restaurant?.name || 'Restaurant'} is ready. Swipe to grab!`,
            data: { orderId: _id, type: 'order_pool' },
            channelId: 'order-pool',
          }));
          await sendNotifications(messages);
          console.log(`Sent to ${onlineRiders.length} riders.`);
        } else {
          console.log('⚠️ No online riders found.');
        }
      }
    }

    // 2. WITHDRAWAL LOGIC
    else if (_type === 'withdrawalRequest') {
      if ((status === 'completed' || status === 'declined') && rider?.pushToken) {
        console.log(`💸 Withdrawal Update: ${status}`);
        const notifTitle = status === 'completed' ? 'Withdrawal Successful! 💰' : 'Withdrawal Declined ❌';
        const notifBody = status === 'completed' ? `LKR ${amount} has been transferred.` : `Request for LKR ${amount} was declined.`;

        await sendNotifications([{
          to: rider.pushToken,
          sound: 'default',
          title: notifTitle,
          body: notifBody,
          data: { type: 'withdrawal_update' },
          channelId: 'default',
        }]);
      }
    }

    // 3. ANNOUNCEMENT LOGIC
    else if (_type === 'announcement') {
      console.log(`📢 Announcement: ${title}`);
      let tokens = [];

      if (target === 'riders' || target === 'all') {
        const riders = await client.fetch(`*[_type == "rider" && defined(pushToken)].pushToken`);
        tokens = [...tokens, ...riders];
      }
      
      if (target === 'partners' || target === 'all') {
        const restaurants = await client.fetch(`*[_type == "restaurant" && defined(pushToken)].pushToken`);
        tokens = [...tokens, ...restaurants];
      }

      tokens = [...new Set(tokens)]; // Remove duplicates

      const messages = tokens
        .filter(t => Expo.isExpoPushToken(t))
        .map(t => ({
          to: t,
          sound: 'default',
          title: title,
          body: message,
          data: { type: 'announcement' },
          channelId: 'default',
        }));

      if (messages.length > 0) {
        await sendNotifications(messages);
        console.log(`📢 Sent to ${messages.length} devices.`);
      }
    }

  } catch (err) {
    console.error("Error processing webhook:", err);
  }

  res.status(200).send('Processed');
});

// Local එකේදි වැඩ කරන්න මේක තියන්න
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}

// Vercel එකට වැඩ කරන්න මේක අනිවාර්යයි
module.exports = app;