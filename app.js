require("dotenv").config();
const express = require("express");
const WooCommerceRestApi = require("@woocommerce/woocommerce-rest-api").default;
const { Expo } = require("expo-server-sdk");
const fs = require("fs");

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

//
// ORDERS API
//
app.get("/orders", async (req, res) => {
  try {
    const response = await wc.get("orders", { per_page: 50 });
    res.json(response.data);
  } catch (err) {
    console.error("Error fetching orders:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to fetch orders",
      details: err.response?.data || err.message
    });
  }
});

app.get("/orders/:id", async (req, res) => {
  try {
    const response = await wc.get(`orders/${req.params.id}`);
    res.json(response.data);
  } catch (err) {
    console.error("Error fetching order:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to fetch order",
      details: err.response?.data || err.message
    });
  }
});

app.put("/orders/:id", async (req, res) => {
  try {
    const response = await wc.put(`orders/${req.params.id}`, req.body);
    res.json(response.data);
  } catch (err) {
    console.error("Error updating order:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to update order",
      details: err.response?.data || err.message
    });
  }
});

app.use(
  "/order-created",
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  })
);

//
// DEVICE TOKEN MANAGEMENT
//
const expo = new Expo();
let deviceTokens = [];
const TOKENS_FILE = "./tokens.json";

function loadTokens() {
  if (fs.existsSync(TOKENS_FILE)) {
    try {
      deviceTokens = JSON.parse(fs.readFileSync(TOKENS_FILE));
      console.log("Loaded tokens:", deviceTokens);
    } catch (err) {
      console.log("Failed to load tokens:", err.message);
      deviceTokens = [];
    }
  }
}

function saveTokens() {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(deviceTokens, null, 2));
}

loadTokens();

app.post("/save-token", (req, res) => {
  const { expoPushToken, fcmToken } = req.body;

  if (!expoPushToken && !fcmToken) {
    return res.status(400).json({ error: "No token received" });
  }

  const tokenObj = { expoPushToken, fcmToken };

  const exists = deviceTokens.find(
    (t) => t.expoPushToken === expoPushToken || t.fcmToken === fcmToken
  );

  if (!exists) {
    deviceTokens.push(tokenObj);
    saveTokens();
  }

  return res.json({ success: true });
});

app.get("/test-notification", async (req, res) => {
  try {
    let messages = [];

    deviceTokens.forEach((t) => {
      if (t.expoPushToken) {
        messages.push({
          to: t.expoPushToken,
          title: "Test Notification",
          body: "Push notifications are working",
          sound: "default"
        });
      }
    });

    const chunks = expo.chunkPushNotifications(messages);
    for (let chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//
// WOOCOMMERCE CLIENT
//
const wc = new WooCommerceRestApi({
  url: process.env.WOO_URL,
  consumerKey: process.env.WOO_CK,
  consumerSecret: process.env.WOO_CS,
  version: "wc/v3",
  queryStringAuth: true
});

//
// PRODUCTS
//
app.get("/products", async (req, res) => {
  try {
    const response = await wc.get("products", { per_page: 100 });
    res.json(response.data);
  } catch (err) {
    console.error("Error fetching products:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to fetch products",
      details: err.response?.data || err.message
    });
  }
});

//
// CUSTOMERS AGGREGATED LIST
//
app.get("/customers", async (req, res) => {
  try {
    const response = await wc.get("orders", { per_page: 100, status: "any" });
    const orders = response.data || [];

    const customers = {};

    orders.forEach((order) => {
      const billing = order.billing || {};
      const phone = billing.phone?.trim() || null;
      const email = billing.email?.trim() || null;

      const key = phone || email;
      if (!key) return;

      if (!customers[key]) {
        customers[key] = {
          id: key,
          name: `${billing.first_name || ""} ${billing.last_name || ""}`.trim(),
          email,
          phone,
          city: billing.city || "",
          state: billing.state || "",
          totalOrders: 1,
          totalSpent: parseFloat(order.total) || 0,
          lastOrderDate: order.date_created || null
        };
      } else {
        customers[key].totalOrders += 1;
        customers[key].totalSpent += parseFloat(order.total) || 0;

        if (email && email !== customers[key].email) {
          customers[key].email = email;
        }

        const oldDate = new Date(customers[key].lastOrderDate || 0);
        const newDate = new Date(order.date_created || 0);
        if (newDate > oldDate) customers[key].lastOrderDate = order.date_created;
      }
    });

    const result = Object.values(customers).map((c) => ({
      ...c,
      totalSpent: Number(c.totalSpent.toFixed(2))
    }));

    res.json(result);
  } catch (err) {
    console.error("Error fetching customers:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to fetch customers",
      details: err.response?.data || err.message
    });
  }
});

//
// CUSTOMER ORDERS BY EMAIL OR PHONE
//
app.get("/customers/orders/:id", async (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id).trim().toLowerCase();

    const response = await wc.get("orders", { per_page: 100, status: "any" });
    const orders = response.data || [];

    const filtered = orders.filter((o) => {
      const email = (o.billing.email || "").trim().toLowerCase();
      const phone = (o.billing.phone || "").trim().toLowerCase();
      return email === id || phone === id;
    });

    filtered.sort((a, b) => new Date(b.date_created) - new Date(a.date_created));

    res.json(filtered);
  } catch (err) {
    console.error("Error fetching orders:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to fetch customer orders",
      details: err.response?.data || err.message
    });
  }
});

//
// WEBHOOK: ORDER CREATED
//
app.post("/order-created", async (req, res) => {
  try {
    const order = req.body;

    if (!order || !order.id) {
      return res.status(200).send("OK");
    }

    const messages = [];

    deviceTokens.forEach((t) => {
      if (t.expoPushToken) {
        messages.push({
          to: t.expoPushToken,
          sound: "default",
          title: `New Order #${order.id}`,
          body: `Amount ₹${order.total}`,
          data: { orderId: order.id }
        });
      }
    });

    const chunks = expo.chunkPushNotifications(messages);
    for (let chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk);
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.status(200).send("OK");
  }
});

//
// START SERVER
//
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running on port ${PORT}`);
});
