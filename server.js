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
  for (let message of messages) {
    try {
      // එකින් එක check කරලා යවනවා
      await expo.sendPushNotificationsAsync([message]);
      console.log(`✅ Sent to: ${message.to}`);
    } catch (error) {
      // පරණ account එකේ ටෝකන් එකක් ආවොත් මෙතනින් skip වෙනවා
      console.error(`❌ Skipped invalid token: ${message.to}`);
    }
  }
};

// --- (NEW) HELPER TO GET TOKEN ---
// Webhook eken token eka awe nathnam, DB eken gannawa
const getPushToken = async (refObject) => {
    if (refObject?.pushToken) return refObject.pushToken; // Already thiyenawanam return karanawa
    
    if (refObject?._ref) {
        // Reference ekak nam DB eken fetch karanawa
        const doc = await client.fetch(`*[_id == $id][0]{pushToken}`, { id: refObject._ref });
        return doc?.pushToken;
    }
    return null;
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
      
      // 👇 Token eka gannawa (Reference ekak unath, Object ekak unath wada karana widihata)
      const restaurantToken = await getPushToken(restaurant);

      // A. New Order -> Restaurant (Partner App)
      if (orderStatus === 'pending' && restaurantToken) {
        console.log(`📦 New Order for Restaurant`);
        await sendNotifications([{
          to: restaurantToken,
          sound: 'default',
          title: '🔥 New Order Received!',
          body: 'You have a new order waiting for acceptance.',
          data: { orderId: _id, type: 'new_order' },
          channelId: 'partner-alert', 
        }]);
      }

      // B. Order Cancelled -> Restaurant (Partner App)
      else if (orderStatus === 'cancelled' && restaurantToken) {
        console.log(`❌ Order Cancelled: ${_id}`);
        await sendNotifications([{
          to: restaurantToken,
          sound: 'default',
          title: 'Order Cancelled ❌',
          body: `Order #${_id.slice(-4).toUpperCase()} has been cancelled.`,
          data: { orderId: _id, type: 'order_cancelled' },
          channelId: 'default', 
        }]);
      }

      // C. Order Completed -> Restaurant (Partner App)
      else if (orderStatus === 'completed' && restaurantToken) {
        console.log(`✅ Order Completed: ${_id}`);
        await sendNotifications([{
          to: restaurantToken,
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
            body: `New order is ready for pickup.`,
            data: { orderId: _id, type: 'order_pool' },
            channelId: 'order-pool', 
          }));
          await sendNotifications(messages);
        }
      }
    }

    // 2. WITHDRAWAL LOGIC
    else if (_type === 'withdrawalRequest') {
      const riderToken = await getPushToken(rider); // 👇 Rider token ekath fetch karanawa

      if ((status === 'completed' || status === 'declined') && riderToken) {
        const notifTitle = status === 'completed' ? 'Withdrawal Successful! 💰' : 'Withdrawal Declined ❌';
        const notifBody = status === 'completed' ? `LKR ${amount} has been transferred.` : `Request for LKR ${amount} was declined.`;

        await sendNotifications([{
          to: riderToken,
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
      
      // Send to Riders
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
        }
      }
      
      // Send to Partners
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