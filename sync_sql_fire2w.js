require("dotenv").config();
const sql = require("mssql");
const admin = require("firebase-admin");
const moment = require("moment");


// 🔹 Step 1: Initialize Firebase
// Initialize Firebase
const fs = require('fs'); // Necesario si luego vas a manipular el archivo
const serviceAccount = require('./firebase-key.json');



admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://tsterapp-fcf1b-default-rtdb.firebaseio.com/",
});

const db = admin.database();
const ref = db.ref("Reportes_test2");

// 🔹 Step 2: SQL Server configuration
const sqlConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  server: process.env.DB_HOST,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

// 🔹 Step 3: Main sync controller
async function syncSqlAndFirebase() {
  try {
    await sql.connect(sqlConfig);
    console.log("✅ Connected to SQL Server");

    await enrichSqlReportesWithLuminarias();  // Step 4: Enrich SQL with LuminariasMed
    await pullSqlToFirebase();                // Step 5: Sync SQL → Firebase
    await pushFirebaseToSql();                // Step 6: Sync Firebase → SQL
    await syncWorkDonevNToReportesTest();     // 🔥 New step added here


    console.log("✅ Two-way sync complete.\n");
  } catch (err) {
    console.error("❌ Error:", err);
  } finally {
    await sql.close();
  }
}

// 🔹 Step 4: Enrich SQL Reportes_test with LuminariasMed data
async function enrichSqlReportesWithLuminarias() {
  console.log("🔄 Enriching Reportes_test with LuminariasMed...");

  try {
    const result = await sql.query(`
      SELECT ID, LumAsigID 
      FROM Reportes_test 
      WHERE LumAsigID IS NOT NULL
    `);

    for (const row of result.recordset) {
      const { ID, LumAsigID } = row;

      const lumReq = new sql.Request();
      lumReq.input("lumID", sql.Int, LumAsigID);
      const lumResult = await lumReq.query(`
        SELECT Potencia, TipoLum, RPU 
        FROM LuminariasMed 
        WHERE Id = @lumID
      `);

      if (lumResult.recordset.length === 0) {
        console.warn(`⚠️ No Luminaria found for LumAsigID ${LumAsigID}`);
        continue;
      }

      const { Potencia, TipoLum, RPU } = lumResult.recordset[0];

      const updateReq = new sql.Request();
updateReq.input("ID", sql.Int, ID);
updateReq.input("extra_cap_pot", sql.VarChar(255), Potencia !== undefined && Potencia !== null ? String(Potencia) : null);
updateReq.input("extra_tipo", sql.VarChar(255), TipoLum !== undefined && TipoLum !== null ? String(TipoLum) : null);
updateReq.input("extra_rpu", sql.VarChar(255), RPU !== undefined && RPU !== null ? String(RPU) : null);

await updateReq.query(`
  UPDATE Reportes_test
  SET extra_cap_pot = @extra_cap_pot,
      extra_tipo = @extra_tipo,
      extra_rpu = @extra_rpu
  WHERE ID = @ID
`);


      console.log(`✅ Enriched Reporte ID=${ID}`);
    }

    console.log("✅ Enrichment complete.\n");
  } catch (error) {
    console.error("❌ Error enriching data:", error);
  }
}

// 🔹 Step 5: Push from SQL → Firebase (merging & preserving fields)
async function pullSqlToFirebase() {
  console.log("🔄 Pulling SQL → Firebase...");

  const result = await sql.query(`
    SELECT
      ID, Status, Municipio, CuadrillaName, TrabajoRealizado, LumAsigID,
      FechaCreacion, FechaAsignacion, FechaInicio, FechaConclusion, Origen,
      Asigno, FolioReporte, Colonia, Calle, Numero, EntreCalles,
      ReferenciaProx, Comentarios, Extra, Latitud, Longitud, trabajo,
      extra_cap_pot, extra_tipo, extra_rpu
    FROM Reportes_test
  `);

  if (result.recordset.length === 0) {
    console.log("ℹ️ No records found in SQL.");
    return;
  }

  for (const row of result.recordset) {
    if (!row.ID) continue;
    const firebaseKey = String(row.ID).replace(/[\.\#\$\[\]]/g, "_");

    const snap = await ref.child(firebaseKey).once("value");
    const existingData = snap.val() || {};

    // Preserve Firebase values if set
    if (existingData.CuadrillaName && existingData.CuadrillaName !== "pendiente") {
      row.CuadrillaName = existingData.CuadrillaName;
    }

    if (existingData.FechaAsignacion && existingData.FechaAsignacion !== "") {
      row.FechaAsignacion = existingData.FechaAsignacion;
    }

    await ref.child(firebaseKey).update(row);
    console.log(`✅ Synced to Firebase: ID=${row.ID}`);
  }

  console.log("✅ Pull-to-Firebase step complete.\n");
}

// 🔹 Step 6: Push selective data from Firebase → SQL
async function pushFirebaseToSql() {
  console.log("🔄 Pushing Firebase → SQL (selected fields)...");

  const snap = await ref.once("value");
  if (!snap.exists()) {
    console.log("ℹ️ No data in Firebase to push.");
    return;
  }

  const allRecords = snap.val();

  for (const firebaseKey in allRecords) {
    const record = allRecords[firebaseKey];
    if (!record.ID) continue;

    const { ID, CuadrillaName, FechaAsignacion } = record;

    const checkReq = new sql.Request();
    checkReq.input("id", sql.Int, ID);
    const checkResult = await checkReq.query(`
      SELECT CuadrillaName, FechaAsignacion 
      FROM Reportes_test 
      WHERE ID = @id
    `);

    if (checkResult.recordset.length === 0) continue;

    const sqlRow = checkResult.recordset[0];
    let needUpdate = false;

    if (CuadrillaName && CuadrillaName !== sqlRow.CuadrillaName) {
      needUpdate = true;
    }

    if (FechaAsignacion && FechaAsignacion !== sqlRow.FechaAsignacion) {
      needUpdate = true;
    }

    if (needUpdate) {
      const updateReq = new sql.Request();
      updateReq.input("id", sql.Int, ID);
      updateReq.input("CuadrillaName", sql.VarChar(50), CuadrillaName || null);
      updateReq.input("FechaAsignacion", sql.VarChar(5000), FechaAsignacion || null);

      await updateReq.query(`
        UPDATE Reportes_test
        SET CuadrillaName = @CuadrillaName,
            FechaAsignacion = @FechaAsignacion
        WHERE ID = @id
      `);

      console.log(`✅ Updated SQL: ID=${ID}`);
    }
  }

  console.log("✅ Push-to-SQL step complete.\n");
}

// 🔹 Step 7: Sync causaFalla and trabajoRealizado from WorkDonevN to Reportes_test
async function syncWorkDonevNToReportesTest() {
  console.log("🔄 Syncing WorkDonevN to Reportes_test...");
  

  try {
    const result = await sql.query(`
      SELECT folioReporte, causaFalla, trabajoRealizado, fechaAtendido, fechaInicio
      FROM WorkDonevN
      WHERE folioReporte IS NOT NULL
    `);

    for (const row of result.recordset) {
      const { folioReporte, causaFalla, trabajoRealizado, fechaAtendido, fechaInicio } = row;

      const updateRequest = new sql.Request();
      updateRequest.input("folioReporte", sql.NVarChar(50), folioReporte);
      updateRequest.input("extra_causaFalla", sql.NVarChar(sql.MAX), causaFalla || null);
      updateRequest.input("extra_trabajoRealizado", sql.NVarChar(sql.MAX), trabajoRealizado || null);
      updateRequest.input("FechaConclusion", sql.NVarChar(100), fechaAtendido ? new Date(fechaAtendido).toISOString().slice(0, 19) : null);
      let fechaInicioFormatted = null;

if (fechaInicio) {
  const normalizedFechaInicio = fechaInicio.trim().replace(/\s+/g, " ");
  const parsed = moment(normalizedFechaInicio, "MMM D YYYY h:mmA", true);

  if (parsed.isValid()) {
    fechaInicioFormatted = parsed.format("YYYY-MM-DD HH:mm:ss");
  } else {
    console.warn(`⚠️ Still invalid fechaInicio for folioReporte=${folioReporte}:`, fechaInicio);
  }
} else {
  console.warn(`⚠️ Missing fechaInicio for folioReporte=${folioReporte}:`, fechaInicio);
}


updateRequest.input("FechaInicio", sql.NVarChar(100), fechaInicioFormatted);



      await updateRequest.query(`
        UPDATE Reportes_test
        SET extra_causaFalla = @extra_causaFalla,
            extra_trabajoRealizado = @extra_trabajoRealizado,
            FechaConclusion = @FechaConclusion,
            FechaInicio = @FechaInicio
        WHERE folioReporte = @folioReporte
      `);

      console.log(`✅ Updated Reportes_test for folioReporte=${folioReporte}`);
    }

    console.log("✅ Sync WorkDonevN → Reportes_test complete.\n");
  } catch (error) {
    console.error("❌ Error syncing WorkDonevN to Reportes_test:", error);
  }
}


// ▶️ Run once only (GitHub Actions)
syncSqlAndFirebase();

