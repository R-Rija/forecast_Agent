import express from 'express';
import cors from 'cors';
import sql from 'mssql';
import { DefaultAzureCredential } from '@azure/identity';
import dotenv from 'dotenv';
import { ApifyClient } from 'apify-client';
import Groq from 'groq-sdk';

dotenv.config();

const app = express();
app.use(express.json());

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
            "categoryOrProductUrls": [{ "url": `https://www.amazon.com/s?k=${encodeURIComponent(query)}` }],
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
        res.status(200).json({ success: false, error: err.message, data: [] });
    }
});

app.post('/api/multi-agent-analysis', async (req, res) => {
    const { products } = req.body;
    
    if (!products || !Array.isArray(products) || products.length === 0) {
        return res.status(400).json({ error: "Missing or invalid products array" });
    }

    try {
        if (!process.env.APIFY_API_TOKEN) {
            return res.status(400).json({ error: "APIFY_API_TOKEN is missing on the server." });
        }
        if (!process.env.GROQ_API_KEY) {
            return res.status(400).json({ error: "GROQ_API_KEY is missing on the server." });
        }

        const apifyClient = new ApifyClient({
            token: process.env.APIFY_API_TOKEN,
        });
        
        // We will randomly pick the top product's category to run a fast search
        // Running 5 scrapers for 12 products would take hours and crash the server.
        // We do 1 fast Amazon crawl to represent the "Market Trend" to keep it under 30s.
        const searchKeyword = products[0].category || products[0].name;

        console.log(`[Multi-Agent] Scraping global trends for category: ${searchKeyword}`);
        const run = await apifyClient.actor("junglee/Amazon-crawler").call({
            "categoryOrProductUrls": [{ "url": `https://www.amazon.com/s?k=${encodeURIComponent(searchKeyword)}` }],
            "maxItems": 3,
            "proxyConfiguration": { "useApifyProxy": true }
        });
        
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
        const marketData = items.slice(0, 3).map(item => ({
            title: item.title,
            price: item.price,
            rating: item.rating
        }));

        // Now initialize Groq
        const groq = new Groq({
            apiKey: process.env.GROQ_API_KEY,
        });

        // Generate reasoning for ALL products in one prompt
        const prompt = `
        You are an elite Autonomous Supply Chain AI connected to Microsoft Fabric, YouTube, Instagram, Amazon, Shopee, and Alibaba.
        
        Recent Market Data Scraped for ${searchKeyword}:
        ${JSON.stringify(marketData)}
        
        Generate a unique, single-paragraph "AI Intelligence Reasoning" for each of the following products. 
        Incorporate current hypothetical weather patterns, social media viral trends (TikTok/Instagram), competitor pricing, and stockout risks based on the available stock vs demand.
        Keep it concise, plain text only (NO bolding, NO asterisks, NO markdown).
        
        Products to analyze:
        ${JSON.stringify(products)}
        
        Return ONLY a JSON dictionary where the key is the SKU and the value is the reasoning string. Example: {"SKU-1001": "Based on a viral TikTok trend..."}
        `;

        const completion = await groq.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: "openai/gpt-oss-120b",
            temperature: 0.7,
            response_format: { type: "json_object" }
        });

        const reasonings = JSON.parse(completion.choices[0]?.message?.content || "{}");
        
        res.status(200).json({ success: true, reasonings });
    } catch (err) {
        console.error("Multi-Agent Analysis Error:", err);
        res.status(200).json({ success: false, error: err.message, reasonings: {} });
    }
});
app.post('/api/chat', async (req, res) => {
    const { userMsg, rows, marketIntelligence } = req.body;
    
    if (!userMsg) {
        return res.status(400).json({ error: "Missing userMsg" });
    }

    try {
        if (!process.env.GROQ_API_KEY) {
            return res.status(200).json({ success: false, error: "GROQ_API_KEY is missing on the server." });
        }

        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        
        let weatherContext = "";
        // Simple regex to catch "weather in [city]" or "wheather in [city]"
        const weatherMatch = userMsg.match(/wheather in ([\w\s]+)|weather in ([\w\s]+)/i);
        const city = weatherMatch ? (weatherMatch[1] || weatherMatch[2]).trim() : null;
        
        if (city && process.env.WEATHER_API_KEY) {
            try {
                const weatherRes = await fetch(`http://api.weatherapi.com/v1/current.json?key=${process.env.WEATHER_API_KEY}&q=${encodeURIComponent(city)}`);
                const weatherData = await weatherRes.json();
                if (weatherData && weatherData.current) {
                    weatherContext = `\nLIVE WEATHER FOR ${city.toUpperCase()}: ${weatherData.current.condition.text}, ${weatherData.current.temp_c}°C (${weatherData.current.temp_f}°F), Humidity: ${weatherData.current.humidity}%.`;
                }
            } catch (err) {
                console.error("Weather API error:", err);
            }
        }

        const systemPrompt = `You are an Autonomous Retail Intelligence Agent. You have direct access to the live Microsoft Fabric Lakehouse data rows: ${JSON.stringify(rows || [])}. 
The data columns are: [0: SKU, 1: Product Name, 2: Category, 3: Subcategory, 4: Region, 5: Warehouse, 6: Available Stock, 7: Predicted Demand, 8: Stockout Risk, 9: AI Reasoning].

You ALSO have access to this real-time web scraped data from Apify:
${marketIntelligence || "No market data available."}${weatherContext}

CRITICAL INSTRUCTIONS:
1. NEVER output raw markdown tables of the entire dataset unless the user explicitly asks for a "table" of all data.
2. When asked general questions, provide a highly concise summary.
3. Keep answers extremely brief, human-like, and directly address the user's prompt.
4. Always factor in the live Apify market data if it is relevant to the user's question (e.g. mention competitor prices if available).
5. DO NOT use markdown formatting like ** or bullet points. Use plain text only.
6. DO NOT explain mathematical formulas or logic. Just state the region, the reason, and the numbers naturally.
7. DO NOT use em dashes or en dashes anywhere in your response. Use standard commas or periods for pauses.`;

        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMsg }
            ],
            model: "openai/gpt-oss-120b",
            temperature: 0.7
        });

        res.status(200).json({ success: true, reply: completion.choices[0]?.message?.content || "No response." });
    } catch (err) {
        console.error("Chat API Error:", err);
        res.status(200).json({ success: false, error: err.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Backend server listening on port ${PORT}`);
});
