import express from 'express';
import cors from 'cors';
import sql from 'mssql';
import { DefaultAzureCredential } from '@azure/identity';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

// Robust custom CORS middleware to guarantee Private Network Access is allowed
app.use((req, res, next) => {
    const origin = req.headers.origin || '*';
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Access-Control-Request-Private-Network');
    res.header('Access-Control-Allow-Private-Network', 'true');
    
    // Intercept OPTIONS method for preflight
    if (req.method === 'OPTIONS') {
        return res.status(204).send('');
    }
    next();
});

const SQL_ENDPOINT = process.env.SQL_ENDPOINT || "omkursj7icje3afttfwpqwos6a-noerjr5rfpvetigsz7dwv6us7i.datawarehouse.fabric.microsoft.com";
const DATABASE_NAME = SQL_ENDPOINT.split('.')[0];

app.get('/api/query', async (req, res) => {
    const table = req.query.table;
    const allowedTables = ["sales_transactions", "allocation_recommendations", "executed_actions"];
    
    if (!table || !allowedTables.includes(table)) {
        return res.status(400).json({ error: "Invalid or missing table name parameter." });
    }

    try {
        // Fetch Entra ID Token using the local dev environment context
        const credential = new DefaultAzureCredential();
        const tokenResponse = await credential.getToken("https://database.windows.net/.default");
        
        // Connect to Fabric SQL using the retrieved Entra ID token
        const config = {
            server: SQL_ENDPOINT,
            database: DATABASE_NAME,
            authentication: {
                type: 'azure-active-directory-access-token',
                options: {
                    token: tokenResponse.token
                }
            },
            options: {
                encrypt: true,
                trustServerCertificate: false
            }
        };

        const pool = await sql.connect(config);
        
        // Execute the query
        const result = await pool.request().query(`SELECT TOP 50 * FROM [${table}]`);
        
        res.status(200).json({
            success: true,
            row_count: result.recordset.length,
            rows: result.recordset
        });

    } catch (err) {
        console.error("SQL Error:", err);
        res.status(500).json({ error: err.message, success: false });
    }
});

app.all('/api/run-pipeline', async (req, res) => {
    const workspaceId = "c714896b-2bb1-49ea-a0d2-cfc76afa92fa";
    const pipelineId = "670b3516-0b5c-47f4-87b0-0c2d65024ba5";

    try {
        const credential = new DefaultAzureCredential();
        // The scope for Fabric REST API is https://api.fabric.microsoft.com/.default
        const tokenResponse = await credential.getToken("https://api.fabric.microsoft.com/.default");

        const response = await fetch(
            `https://api.fabric.microsoft.com/v1/workspaces/${workspaceId}/items/${pipelineId}/jobs/instances?jobType=Pipeline`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${tokenResponse.token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (response.ok) {
            res.send(`
                <html>
                    <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                        <h2>✅ Pipeline Triggered Successfully!</h2>
                        <p>Agents are re-analyzing live APIs.</p>
                        <p>This tab will close automatically...</p>
                        <script>
                            setTimeout(() => window.close(), 2500);
                        </script>
                    </body>
                </html>
            `);
        } else {
            const errorText = await response.text();
            res.status(response.status).send(`
                <html>
                    <body style="font-family: sans-serif; text-align: center; padding: 50px; color: red;">
                        <h2>❌ Error triggering pipeline</h2>
                        <p>${errorText}</p>
                    </body>
                </html>
            `);
        }
    } catch (err) {
        console.error("Pipeline Trigger Error:", err);
        res.status(500).send(`
            <html>
                <body style="font-family: sans-serif; text-align: center; padding: 50px; color: red;">
                    <h2>❌ Error triggering pipeline</h2>
                    <p>${err.message}</p>
                </body>
            </html>
        `);
    }
});

import { ApifyClient } from 'apify-client';

app.post('/api/market-intelligence', async (req, res) => {
    const { query } = req.body;
    
    if (!query) {
        return res.status(400).json({ error: "Missing query parameter" });
    }

    try {
        // Initialize the ApifyClient with API token
        const client = new ApifyClient({
            token: process.env.APIFY_API_TOKEN,
        });

        // We will run the Amazon scraper as a demonstration for market intelligence.
        // Running all 5 synchronously would take too long and cause timeouts.
        const input = {
            "categoryUrl": `https://www.amazon.com/s?k=${encodeURIComponent(query)}`,
            "maxItems": 3,
            "proxyConfiguration": { "useApifyProxy": true }
        };

        console.log(`Starting Apify Amazon Crawler for: ${query}`);
        // Run the Amazon crawler actor and wait for it to finish
        const run = await client.actor("junglee/Amazon-crawler").call(input);
        
        console.log(`Fetching results from dataset: ${run.defaultDatasetId}`);
        // Fetch the results from the actor's dataset
        const { items } = await client.dataset(run.defaultDatasetId).listItems();
        
        // Summarize the top 3 items to avoid sending massive payloads to the frontend
        const summary = items.slice(0, 3).map(item => ({
            title: item.title,
            price: item.price,
            rating: item.rating,
            availability: item.availability || "Unknown"
        }));

        res.status(200).json({ success: true, data: summary });
    } catch (err) {
        console.error("Apify Error:", err);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Backend server listening on port ${PORT}`);
});
