require('dotenv').config();
const sql = require("mssql");
const admin = require("firebase-admin");

// Initialize Firebase
const fs = require('fs'); // Necesario si luego vas a manipular el archivo
const serviceAccount = require('./firebase-key.json');

//const serviceAccount = require("./tsterapp-fcf1b-firebase-adminsdk-ig5rv-3cb042b28e.json"); // Ensure correct filename
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://tsterapp-fcf1b-default-rtdb.firebaseio.com/",
});

const db = admin.database();
const ref = db.ref("WorkDone"); // Firebase bucket

// SQL Server Configuration
const sqlConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  server: process.env.DB_HOST,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  }
};

async function fetchDataAndUpdateWorkDonevN() {
  try {
    await sql.connect(sqlConfig);
    console.log("Connected to SQL Server");

    const snapshot = await ref.once("value");
    if (!snapshot.exists()) {
      console.log("No data found in Firebase.");
      return;
    }

    const data = snapshot.val();

    for (const key in data) {
      const record = data[key];

      if (!record.folioReporte || typeof record.folioReporte !== "string") {
        console.warn("Skipping record without a valid folioReporte:", record);
        continue;
      }

      const folio = parseInt(record.folio) || null;
      const fechaInicio = record.fechaInicio ? new Date(record.fechaInicio): null;
      const fechaAtendido = record.fechaAtendido ? new Date(record.fechaAtendido) : null;
      const latitud = record.latitud ? parseFloat(record.latitud) : null;
      const longitud = record.longitud ? parseFloat(record.longitud) : null;

      const query = `
        MERGE INTO WorkDonevN AS target
        USING (SELECT @folioReporte AS folioReporte) AS source
        ON target.folioReporte = source.folioReporte
        WHEN MATCHED THEN 
            UPDATE SET 
                causaFalla = @causaFalla,
                
                estatus = @estatus,
                folio = @folio,
                fechaAtendido = @fechaAtendido,
                fechaInicio = @fechaInicio,
                latitud = @latitud,
                longitud = @longitud,
                responsable = @responsable,
                firma = @firma,
                trabajoRealizado = @trabajoRealizado
        WHEN NOT MATCHED THEN 
            INSERT (causaFalla, estatus, folio, folioReporte, fechaAtendido, fechaInicio, latitud, longitud, responsable, firma, trabajoRealizado)
            VALUES (@causaFalla, @estatus, @folio, @folioReporte, @fechaAtendido, @fechaInicio, @latitud, @longitud, @responsable, @firma, @trabajoRealizado);
      `;

      const request = new sql.Request();
      request.input("causaFalla", sql.NVarChar, record.causaFalla || null);
      //request.input("colonia", sql.NVarChar, record.colonia || null);
      request.input("estatus", sql.NVarChar, record.estatus || null);
      request.input("folio", sql.Int, folio);
      request.input("folioReporte", sql.NVarChar, record.folioReporte);
      request.input("fechaAtendido", sql.DateTime, fechaAtendido);
      request.input("fechaInicio", sql.DateTime, fechaInicio);
      request.input("latitud", sql.Float, latitud);
      request.input("longitud", sql.Float, longitud);
      request.input("responsable", sql.NVarChar, record.responsable || null);
      request.input("firma", sql.NVarChar, record.firma || null);
      request.input("trabajoRealizado", sql.NVarChar, record.trabajoRealizado || null);

      await request.query(query);
      console.log(`Updated/Inserted: ${record.folioReporte}`);
    }

    console.log("Data synchronization to WorkDonevN complete.");
  } catch (err) {
    console.error("Error:", err);
  } finally {
    sql.close();
  }
}

// Run every 60 seconds
setInterval(fetchDataAndUpdateWorkDonevN, 60000);

// Initial execution
fetchDataAndUpdateWorkDonevN();
