const express = require("express");
const app = express();
const port = process.env.PORT || 5000;
const cors = require("cors");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion } = require("mongodb");
const nodemailer = require("nodemailer");
const sgTransport = require("nodemailer-sendgrid-transport");

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.slurq.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
// console.log(uri);
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

function verifyjwt(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "Forbidden Access" });
    }
    req.decoded = decoded;
    next();
    // console.log(decoded);
  });
}

const options = {
  auth: {
    api_key: process.env.EMAIL_SENDER_KEY,
  },
};
const emailClient = nodemailer.createTransport(sgTransport(options));

function sendAppointMail(booking) {
  const {patient,patientName,date,slot,bookAppointment} = booking;
  const email = {
    from:process.env.EMAIL_SENDER,
    to: patient,
    subject: `Your appointment for ${bookAppointment} is on ${date} at ${slot} is confirmed.`,
    text: `Your appointment for ${bookAppointment} is on ${date} at ${slot} is confirmed.`,
    html: `
      <div>
        <p> Hello ${patientName}, </p>
        <h3>Your Appointment for ${bookAppointment} is confirmed</h3>
        <p>Looking forward to seeing you on ${date} at ${slot}.</p>
        
        <h3>Our Address</h3>
        <p>Andor Killa Bandorban</p>
        <p>Bangladesh</p>
        <a href="https://web.programming-hero.com/">unsubscribe</a>
      </div>
    `
  };

  emailClient.sendMail(email, function(err, info){
    if (err ){
      console.log(err);
    }
    else {
      console.log('Message sent: ' , info);
    }
});
}

async function run() {
  try {
    await client.connect();
    const servicesCollection = client
      .db("doctors-portal")
      .collection("services");
    const bookingCollection = client
      .db("doctors_portal")
      .collection("bookings");
    const usersCollection = client.db("doctors_portal").collection("users");
    const doctorsCollection = client.db("doctors_portal").collection("doctors");

    const verifyAdmin = async (req, res, next) => {
      const requester = req.decoded.email;
      const requesterAccount = await usersCollection.findOne({
        email: requester,
      });
      if (requesterAccount.role === "admin") {
        next();
      } else {
        res.status(403).send({ message: "forbidden" });
      }
    };

    // console.log(servicesCollection);

    app.get("/service", async (req, res) => {
      const query = {};
      const services = await servicesCollection
        .find(query)
        .project({ name: 1 })
        .toArray();
      res.send(services);
    });
    app.get("/available", async (req, res) => {
      const date = req.query.date;
      const services = await servicesCollection.find().toArray();
      const query = { date: date };
      const bookings = await bookingCollection.find(query).toArray();
      // services.forEach(service => {
      //   const serviceBookings = bookings.filter(
      //     b => b.bookAppointment === service.name
      //   );
      //   booked = serviceBookings.map(s => s.slot);
      //   const available = service.slots.filter(s => !booked.includes(s));
      //   service.available = available;
      // });

      services.forEach(service => {
        const bookedServices = bookings.filter(
          b => b.bookAppointment === service.name
        );

        const booked = bookedServices.map(b => b.slot);

        const available = service.slots.filter(s => !booked.includes(s));
        service.slots = available;
      });

      res.send(services);
    });

    app.get("/user", verifyjwt, async (req, res) => {
      const users = await usersCollection.find().toArray();
      res.send(users);
    });

    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const options = { upsert: true };
      const updateDoc = { $set: user };
      const result = await usersCollection.updateOne(
        filter,
        updateDoc,
        options
      );
      const token = jwt.sign(
        { email: email },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: "30d" }
      );
      res.send({ result, token });
    });

    app.get("/admin/:email", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email: email });
      const isAdmin = user.role === "admin";
      res.send({ admin: isAdmin });
    });

    app.put("/user/admin/:email", verifyjwt, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const updateDoc = {
        $set: { role: "admin" },
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    app.get("/booking", verifyjwt, async (req, res) => {
      const patient = req.query.patient;
      const decodedEmail = req.decoded.email;
      if (patient === decodedEmail) {
        const query = { patient: patient };
        const bookings = await bookingCollection.find(query).toArray();
        return res.send(bookings);
      } else {
        return res.status(403).send({ message: "Forbidden Access" });
      }
    });

    app.post("/booking", async (req, res) => {
      const booking = req.body;
      const query = {
        bookAppointment: booking.bookAppointment,
        date: booking.date,
        patient: booking.patient,
      };
      const exist = await bookingCollection.findOne(query);
      if (exist) {
        return res.send({ success: false, booking: exist });
      }
      const result = await bookingCollection.insertOne(booking);
      sendAppointMail(booking);
      return res.send({ success: true, result });
    });

    app.get("/doctor", verifyjwt, verifyAdmin, async (req, res) => {
      const users = await doctorsCollection.find().toArray();
      res.send(users);
    });

    app.post("/doctor", verifyjwt, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorsCollection.insertOne(doctor);
      res.send(result);
    });
    app.delete("/doctor/:email", verifyjwt, verifyAdmin, async (req, res) => {
      const doctor = req.params.email;
      const filter = { email: doctor };
      const result = await doctorsCollection.deleteOne(filter);
      res.send(result);
    });
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("hi arick");
});
app.listen(port, () => {
  console.log(`port running ${port}`);
});
