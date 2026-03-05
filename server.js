import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

const SHOPIFY_GRAPHQL_URL = `https://${SHOPIFY_STORE}/admin/api/2024-01/graphql.json`;
const SHOPIFY_REST_URL = `https://${SHOPIFY_STORE}/admin/api/2024-01`;

// In-memory store for price adjustments
const adjustments = {};

// Get access token
async function getAccessToken() {
  // The secret is already an access token (shpss_ prefix)
  return SHOPIFY_CLIENT_SECRET;
}

// Query draft order
async function queryDraftOrder(draftOrderId, accessToken) {
  // Handle both numeric IDs and full gid format
  const fullId = draftOrderId.startsWith('gid://')
    ? draftOrderId
    : `gid://shopify/DraftOrder/${draftOrderId}`;

  const query = `
    query {
      draftOrder(id: "${fullId}") {
        id
        email
        customer {
          firstName
          lastName
        }
        lineItems(first: 10) {
          edges {
            node {
              id
              title
              quantity
              originalUnitPrice
              customAttributes {
                key
                value
              }
            }
          }
        }
        subtotalPrice
        totalPrice
      }
    }
  `;

  const response = await fetch(SHOPIFY_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });

  const data = await response.json();
  if (data.errors) {
    throw new Error('GraphQL error: ' + JSON.stringify(data.errors));
  }
  return data.data.draftOrder;
}

// Store price adjustments locally
function saveAdjustments(draftOrderId, lineItems) {
  const numericId = draftOrderId.replace(/\D/g, '');
  adjustments[numericId] = {
    savedAt: new Date().toISOString(),
    lineItems: lineItems,
  };
  return adjustments[numericId];
}

// Get stored adjustments
function getAdjustments(draftOrderId) {
  const numericId = draftOrderId.replace(/\D/g, '');
  return adjustments[numericId] || null;
}

// API endpoint: List all draft orders (for debugging)
app.get('/api/draft-orders', async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const query = `
      query {
        draftOrders(first: 20) {
          edges {
            node {
              id
              email
              customer {
                firstName
                lastName
              }
            }
          }
        }
      }
    `;

    const response = await fetch(SHOPIFY_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    const data = await response.json();
    if (data.errors) {
      throw new Error('GraphQL error: ' + JSON.stringify(data.errors));
    }
    res.json(data.data.draftOrders.edges.map(e => e.node));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API endpoint: Get draft order
app.get('/api/draft-order/:id', async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const draftOrder = await queryDraftOrder(req.params.id, accessToken);
    res.json(draftOrder);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API endpoint: Save price adjustments (local storage)
app.post('/api/draft-order/:id/update', async (req, res) => {
  try {
    const adjustmentData = saveAdjustments(req.params.id, req.body.lineItems);
    res.json({
      success: true,
      message: 'Price adjustments saved',
      adjustments: adjustmentData,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API endpoint: Get saved adjustments
app.get('/api/draft-order/:id/adjustments', (req, res) => {
  const adjustmentData = getAdjustments(req.params.id);
  if (!adjustmentData) {
    return res.json({ adjustments: null });
  }
  res.json({ adjustments: adjustmentData });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
