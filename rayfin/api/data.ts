import { RayfinRequest, RayfinResponse } from '@microsoft/rayfin';
import sql from 'mssql';
import { ClientSecretCredential } from '@azure/identity';

// Read SP credentials from environment
const tenantId = process.env.AZURE_TENANT_ID!;
const clientId = process.env.AZURE_CLIENT_ID!;
const clientSecret = process.env.AZURE_CLIENT_SECRET!;

const sqlEndpoint = "omkursj7icje3afttfwpqwos6a-noerjr5rfpvetigsz7dwv6us7i.datawarehouse.fabric.microsoft.com";

let _pool: sql.ConnectionPool | null = null;

async function getPool() {
  if (_pool) return _pool;

  // 1. Get an access token for Azure SQL
  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  const tokenResponse = await credential.getToken("https://database.windows.net/.default");

  // 2. Configure mssql
  const config: sql.config = {
    server: sqlEndpoint,
    database: "DemandModel", // Usually the lakehouse name. Fabric endpoint databases often match the lakehouse/warehouse name. Wait, I should assume "demandModel" or "Fabric_Apps" ? I'll just omit database for now and query fully qualified if needed, or set it to DemandModel. Wait, I'll use "demandModel" since that is the connection name, or maybe it doesn't strictly matter if we don't specify it, but mssql requires a database name for Azure SQL. I'll use the workspace name or lakehouse name.
    options: {
      encrypt: true,
      trustServerCertificate: false
    },
    authentication: {
      type: "azure-active-directory-access-token",
      options: {
        token: tokenResponse.token
      }
    }
  };

  _pool = new sql.ConnectionPool(config);
  await _pool.connect();
  return _pool;
}

export default async function handler(req: RayfinRequest, res: RayfinResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const pool = await getPool();

    // Query the tables
    const [salesData, allocData, auditsData] = await Promise.all([
      pool.request().query('SELECT TOP 100 * FROM sales_transactions'),
      pool.request().query('SELECT TOP 100 * FROM allocation_recommendations'),
      pool.request().query('SELECT TOP 100 * FROM executed_actions')
    ]);

    return res.status(200).json({
      sales_transactions: salesData.recordset,
      allocation_recommendations: allocData.recordset,
      executed_actions: auditsData.recordset
    });

  } catch (error: any) {
    console.error("SQL Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
