// ===============================
// Mock Testing API
// ===============================
const jsonServer = require("json-server");
const path = require("path");

const server = jsonServer.create();
const router = jsonServer.router("db.json");
const middlewares = jsonServer.defaults({ static: "public" });

server.use(middlewares);

// Root message
server.get("/", (req, res) => {
  res.json({ message: "Team 7's Mock API is running." });
});

// Basic health for debugging
server.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "mock-testing-api",
    time: new Date().toISOString()
  });
});

// Wake-up health check for Render / UptimeRobot
server.get("/healthz", (req, res) => {
  // If the process is up and this route responds, consider it healthy.
  return res.sendStatus(200);
});

server.use(jsonServer.bodyParser);

/* ------------------------------------------------------------------
   Rule 1: Require a name when creating a customer
------------------------------------------------------------------ */
server.post("/api/customers", (req, res, next) => {
  if (!req.body.name) {
    return res.status(400).json({ error: "Customer name is required" });
  }
  next();
});

/* ------------------------------------------------------------------
   Rule 2: Prevent deleting customers
------------------------------------------------------------------ */
server.delete("/api/customers/:id", (req, res) => {
  res.status(403).json({ error: "Deleting customers is not allowed" });
});

/* ------------------------------------------------------------------
   Rule 3: Only return orders with totals >= 50
------------------------------------------------------------------ */
server.get("/api/orders", (req, res) => {
  const db = router.db; // access lowdb instance
  const allOrders = db.get("orders").value();
  const filtered = allOrders.filter((order) => order.total >= 50);
  res.json(filtered);
});

/* ------------------------------------------------------------------
   Rule 4: Simulate a 2-second network delay
------------------------------------------------------------------ */
server.use((req, res, next) => {
  setTimeout(() => next(), 2000);
});

/* ------------------------------------------------------------------
   Rule 5: Simulate payment authorization using external response files
   Rubric: single /authorize endpoint with 4 weighted outcomes (60/17/17/6) :contentReference[oaicite:8]{index=8}
------------------------------------------------------------------ */
const successTemplate = require(path.join(
  __dirname,
  "responses",
  "SuccessResponse.json"
));
const incorrectCardTemplate = require(path.join(
  __dirname,
  "responses",
  "IncorrectCardDetailsResponse.json"
));
const insufficientFundsTemplate = require(path.join(
  __dirname,
  "responses",
  "InsufficentFundsResponse.json"
));
const error500Template = require(path.join(
  __dirname,
  "responses",
  "500ErrorResponse.json"
));

server.post("/authorize", (req, res) => {
  const chance = Math.random();
  const { OrderId, RequestedAmount, CardDetails } = req.body || {};

  // 60% success
  if (chance < 0.6) {
    const body = {
      ...successTemplate,
      OrderId:
        OrderId ||
        successTemplate.OrderId ||
        "ORDER-" + Math.floor(Math.random() * 10000),
      AuthorizedAmount:
        RequestedAmount || successTemplate.AuthorizedAmount || 0
    };
    return res.status(200).json(body);
  }

  // Next 17% – incorrect card details
  if (chance < 0.77) {
    const body = { ...incorrectCardTemplate, OrderId };
    return res.status(400).json(body);
  }

  // Next 17% – insufficient funds
  if (chance < 0.94) {
    const body = { ...insufficientFundsTemplate, OrderId };
    return res.status(402).json(body);
  }

  // Final 6% – internal server error
  return res.status(500).json(error500Template);
});

//--------------------------------------------------------------
// Forward local requests to the Beeceptor endpoint
//--------------------------------------------------------------
import("node-fetch").then(({ default: fetch }) => {
  server.post("/external-authorize", async (req, res) => {
    try {
      // Forward the same JSON body to Beeceptor
      const beeceptorResponse = await fetch(
        "https://capstoneproject.proxy.beeceptor.com/authorize",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req.body)
        }
      );

      // Beeceptor may return JSON or plain text
      const contentType = beeceptorResponse.headers.get("content-type") || "";
      const data = contentType.includes("application/json")
        ? await beeceptorResponse.json()
        : await beeceptorResponse.text();

      res.status(beeceptorResponse.status).send(data);
    } catch (err) {
      console.error("Error forwarding to Beeceptor:", err);
      res.status(500).json({
        error: "Failed to reach Beeceptor endpoint",
        details: err.message
      });
    }
  });
});

/* ------------------------------------------------------------------
   Additional static mock response endpoints
------------------------------------------------------------------ */
server.get("/success", (req, res) =>
  res.json(require("./responses/SuccessResponse.json"))
);

server.get("/incorrect-card", (req, res) =>
  res.json(require("./responses/IncorrectCardDetailsResponse.json"))
);

server.get("/insufficient-funds", (req, res) =>
  res.json(require("./responses/InsufficentFundsResponse.json"))
);

server.get("/error500", (req, res) =>
  res.status(500).json(require("./responses/500ErrorResponse.json"))
);

/* ------------------------------------------------------------------
   Use default routes under /api
------------------------------------------------------------------ */
server.use("/api", router);

/* ------------------------------------------------------------------
   Start the server
------------------------------------------------------------------ */
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Mock API running at http://localhost:${PORT}`);
});
