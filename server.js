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
   Card type detection 
------------------------------------------------------------------ */
function detectCardType(cardNumber) {
  const digits = (cardNumber || "").replace(/\D/g, "");

  // Visa: starts with 4, length 13 or 16 or 19
  if (/^4\d{12}(\d{3})?(\d{3})?$/.test(digits)) {
    return "VISA";
  }

  // Mastercard: 51–55 or 2221–2720, length 16
  if (
    /^(5[1-5]\d{14}|2(2[2-9]\d{2}|[3-6]\d{3}|7([01]\d{2}|20\d))\d{10})$/.test(
      digits
    )
  ) {
    return "MASTERCARD";
  }

  // Amex: starts with 34 or 37, length 15
  if (/^3[47]\d{13}$/.test(digits)) {
    return "AMEX";
  }

  // Discover (basic pattern)
  if (/^6(?:011|5\d{2})\d{12}$/.test(digits)) {
    return "DISCOVER";
  }

  return "UNKNOWN";
}

function getCardNumberFromDetails(CardDetails) {
  if (!CardDetails) return "";

  // Allow either a raw string or an object
  if (typeof CardDetails === "string") return CardDetails;

  return (
    CardDetails.cardNumber ||
    CardDetails.CardNumber ||
    CardDetails.number ||
    CardDetails.pan ||
    ""
  );
}

/* ------------------------------------------------------------------
   Rule 5: Simulate payment authorization
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

  // --- Card type verification for rubric ---
  const cardNumber = getCardNumberFromDetails(CardDetails);
  const cardType = detectCardType(cardNumber);

  // If the card type is unknown, treat as incorrect
  if (!cardNumber || cardType === "UNKNOWN") {
    const body = {
      ...incorrectCardTemplate,
      OrderId:
        OrderId ||
        incorrectCardTemplate.OrderId ||
        "ORDER-" + Math.floor(Math.random() * 10000),
      Reason:
        incorrectCardTemplate.Reason ||
        "Unsupported or invalid card type. Only Visa / Mastercard / Amex / Discover test cards are accepted.",
      CardType: "UNKNOWN"
    };
    return res.status(400).json(body);
  }

  // 60% success
  if (chance < 0.6) {
    const body = {
      ...successTemplate,
      OrderId:
        OrderId ||
        successTemplate.OrderId ||
        "ORDER-" + Math.floor(Math.random() * 10000),
      AuthorizedAmount:
        RequestedAmount || successTemplate.AuthorizedAmount || 0,
      CardType: cardType
    };
    return res.status(200).json(body);
  }

  // 17% incorrect card details
  if (chance < 0.77) {
    const body = {
      ...incorrectCardTemplate,
      OrderId:
        OrderId ||
        incorrectCardTemplate.OrderId ||
        "ORDER-" + Math.floor(Math.random() * 10000),
      CardType: cardType
    };
    return res.status(400).json(body);
  }

  //  17% insufficient funds
  if (chance < 0.94) {
    const body = {
      ...insufficientFundsTemplate,
      OrderId:
        OrderId ||
        insufficientFundsTemplate.OrderId ||
        "ORDER-" + Math.floor(Math.random() * 10000),
      CardType: cardType
    };
    return res.status(402).json(body);
  }

  // 6% internal server error
  const body = {
    ...error500Template,
    CardType: cardType
  };
  return res.status(500).json(body);
});

//--------------------------------------------------------------
// Forward local requests to the endpoint
//--------------------------------------------------------------
import("node-fetch").then(({ default: fetch }) => {
  server.post("/external-authorize", async (req, res) => {
    try {
      const beeceptorResponse = await fetch(
        "https://capstoneproject.proxy.beeceptor.com/authorize",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req.body)
        }
      );

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
   Mock Response Endpoints
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
