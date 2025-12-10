const express = require('express');
const bodyParser = require('body-parser');
const { Expo } = require('expo-server-sdk');
const { createClient } = require('@sanity/client');
const cors = require('cors');

const app = express();
const expo = new Expo();

app.use(bodyParser.json());
app.use(cors());

const client = createClient({
  projectId: 'p0umau0m',
  dataset: 'production',
  useCdn: false,
  apiVersion: '2023-05-03',
  token: 'skkqogowsBDjKpQP5Vj8K7dGa2PQt9zo8IH2ZAuFVBYPQN1KA61TA0a6DFzeK1rYHjRMYaqVKcYIGixBKOhji8haEteOrwBDgBltybyirZAEyFOuzda5G8Dq7JllntpEakLKER7PYxqdnt1gWmbpwY6Sfcih5pUivas87w7tuCfpz2hynsZe' 
});

// Helper function to send notifications
const sendNotifications = async (messages) => {
  // Expo allows chunks, but separate projects must be handled separately logic-wise.
  // We ensure messages passed here belong to the same batch logic.
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

app.post('/webhook/all', async (req, res) => {
  const { 
    _type, _id, orderStatus, status, 
    foodTotal, amount, title, message, target, 
    restaurant, rider 
  } = req.body;

  console.log(`🔔 Webhook Received: ${_type} | ID: ${_id} | Status: ${orderStatus || status}`);

  try {
    // 1. FOOD ORDER LOGIC
    if (_type === 'foodOrder') {
      
      // A. New Order -> Restaurant (Partner App)
      if (orderStatus === 'pending' && restaurant?.pushToken) {
        console.log(`📦 New Order for: ${restaurant.name}`);
        await sendNotifications([{
          to: restaurant.pushToken,
          sound: 'default',
          title: '🔥 New Order Received!',
          body: 'You have a new order waiting for acceptance.',
          data: { orderId: _id, type: 'new_order' },
          channelId: 'partner-alert', // Loop Sound Channel
        }]);
      }

      // B. Order Cancelled -> Restaurant (Partner App)
      else if (orderStatus === 'cancelled' && restaurant?.pushToken) {
        console.log(`❌ Order Cancelled: ${_id}`);
        await sendNotifications([{
          to: restaurant.pushToken,
          sound: 'default',
          title: 'Order Cancelled ❌',
          body: `Order #${_id.slice(-4).toUpperCase()} has been cancelled.`,
          data: { orderId: _id, type: 'order_cancelled' },
          channelId: 'default', // Normal Sound
        }]);
      }

      // C. Order Completed -> Restaurant (Partner App)
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

      // D. Order Pool -> Riders
      else if (orderStatus === 'readyForPickup') {
        const onlineRiders = await client.fetch(
          `*[_type == "rider" && availability == "online" && defined(pushToken) && !(_id in path("drafts.**"))] { pushToken }`
        );

        if (onlineRiders.length > 0) {
          const messages = onlineRiders.map(r => ({
            to: r.pushToken,
            sound: 'default',
            title: 'New Order Available! 🚀',
            body: `New order from ${restaurant?.name || 'Restaurant'} is ready.`,
            data: { orderId: _id, type: 'order_pool' },
            channelId: 'order-pool', // Loop Sound Channel
          }));
          await sendNotifications(messages);
        }
      }
    }

    // 2. WITHDRAWAL LOGIC
    else if (_type === 'withdrawalRequest') {
      if ((status === 'completed' || status === 'declined') && rider?.pushToken) {
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

    // 3. ANNOUNCEMENT LOGIC (FIXED: Split Sending)
    else if (_type === 'announcement') {
      console.log(`📢 Announcement: ${title}`);
      
      // --- PART 1: SEND TO RIDERS ---
      if (target === 'riders' || target === 'all') {
        const riders = await client.fetch(`*[_type == "rider" && defined(pushToken)].pushToken`);
        const uniqueRiders = [...new Set(riders)].filter(t => Expo.isExpoPushToken(t));
        
        if (uniqueRiders.length > 0) {
             const riderMessages = uniqueRiders.map(t => ({
                to: t,
                sound: 'default',
                title: title,
                body: message,
                data: { type: 'announcement' },
                channelId: 'default',
            }));
            await sendNotifications(riderMessages);
            console.log(`📢 Sent to ${uniqueRiders.length} Riders.`);
        }
      }
      
      // --- PART 2: SEND TO PARTNERS ---
      if (target === 'partners' || target === 'all') {
        const restaurants = await client.fetch(`*[_type == "restaurant" && defined(pushToken)].pushToken`);
        const uniquePartners = [...new Set(restaurants)].filter(t => Expo.isExpoPushToken(t));
        
        if (uniquePartners.length > 0) {
            const partnerMessages = uniquePartners.map(t => ({
                to: t,
                sound: 'default',
                title: title,
                body: message,
                data: { type: 'announcement' },
                channelId: 'default',
            }));
            await sendNotifications(partnerMessages);
            console.log(`📢 Sent to ${uniquePartners.length} Partners.`);
        }
      }
    }

  } catch (err) {
    console.error("Error processing webhook:", err);
  }

  res.status(200).send('Processed');
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}
module.exports = app;