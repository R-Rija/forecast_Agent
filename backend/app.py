import os
import struct
import pyodbc
from flask import Flask, request, jsonify
from flask_cors import CORS
from azure.identity import DefaultAzureCredential
from dotenv import load_dotenv

# Load local environment variables if present
load_dotenv()

app = Flask(__name__)
CORS(app)  # Allow cross-origin requests from the React dev server

# Configuration
# The user's exact SQL endpoint provided
SQL_ENDPOINT = os.getenv("SQL_ENDPOINT", "omkursj7icje3afttfwpqwos6a-noerjr5rfpvetigsz7dwv6us7i.datawarehouse.fabric.microsoft.com")
# The database name is usually the first subdomain of the SQL endpoint
DATABASE_NAME = SQL_ENDPOINT.split(".")[0] 
DRIVER = "{ODBC Driver 17 for SQL Server}"

def get_sql_token():
    """Acquire token for the SQL Analytics Endpoint using DefaultAzureCredential"""
    # DefaultAzureCredential will try CLI, VS Code, Environment variables, Managed Identity, etc.
    credential = DefaultAzureCredential()
    token = credential.get_token("https://database.windows.net/.default")
    return token.token

def get_connection():
    """Build the pyodbc connection string and inject the Azure AD token"""
    conn_str = (
        f"Driver={DRIVER};"
        f"Server={SQL_ENDPOINT},1433;"
        f"Database={DATABASE_NAME};"
        f"Encrypt=yes;"
        f"TrustServerCertificate=no;"
        f"Connection Timeout=30;"
    )
    
    # Pack the token for ODBC driver usage (SQL_COPT_SS_ACCESS_TOKEN)
    token = get_sql_token()
    token_bytes = token.encode("UTF-16-LE")
    token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)
    
    conn = pyodbc.connect(conn_str, attrs_before={1256: token_struct})
    return conn

@app.route("/api/query", methods=["GET"])
def query_data():
    table = request.args.get("table")
    allowed_tables = ["sales_transactions", "allocation_recommendations", "executed_actions"]
    
    if not table or table not in allowed_tables:
        return jsonify({"error": "Invalid or missing table name parameter."}), 400

    try:
        conn = get_connection()
        cursor = conn.cursor()
        
        # Use parameterized query syntax defensively, though table names are strictly validated above
        # The SQL Analytics endpoint supports standard T-SQL
        cursor.execute(f"SELECT TOP 50 * FROM [{table}]")
        
        columns = [column[0] for column in cursor.description]
        rows = cursor.fetchall()
        
        # Convert pyodbc rows into a list of dicts
        result_rows = []
        for row in rows:
            result_rows.append(dict(zip(columns, row)))
            
        return jsonify({
            "success": True,
            "columns": columns,
            "row_count": len(result_rows),
            "rows": result_rows
        }), 200

    except Exception as e:
        print("SQL Error:", e)
        return jsonify({"error": str(e), "success": False}), 500

if __name__ == "__main__":
    app.run(port=5000, debug=True)
