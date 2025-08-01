# update_data.py
# This script is run by GitHub Actions to update the Cloudflare D1 database.

import os
import yfinance as yf
import requests
from datetime import datetime, timedelta

def execute_d1_batch(account_id, api_token, db_id, queries):
    """Executes a batch of SQL queries against the Cloudflare D1 API."""
    if not queries:
        print("No queries to execute.")
        return

    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{db_id}/batch"
    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json",
    }
    # The batch API expects a list of query objects
    data = [{"sql": query} for query in queries]
    
    print(f"Sending {len(data)} queries to D1 batch endpoint...")
    response = requests.post(url, headers=headers, json=data)
    response.raise_for_status() # Will raise an exception for HTTP error codes
    print("D1 batch execution successful.")
    return response.json()

def main():
    print("Starting data update process...")
    
    CLOUDFLARE_ACCOUNT_ID = os.environ['CLOUDFLARE_ACCOUNT_ID']
    CLOUDFLARE_API_TOKEN = os.environ['CLOUDFLARE_API_TOKEN']
    D1_DATABASE_ID = os.environ['D1_DATABASE_ID']

    # 1. Get unique tickers from the D1 database (using the batch endpoint for a single query)
    try:
        print("Fetching tickers from D1...")
        result = execute_d1_batch(
            CLOUDFLARE_ACCOUNT_ID, 
            CLOUDFLARE_API_TOKEN, 
            D1_DATABASE_ID, 
            ["SELECT DISTINCT ticker FROM transactions"]
        )
        # The result structure for batch is a list of results
        tickers = [item['ticker'] for item in result[0]['results']] if result and result[0]['results'] else []
        if not tickers:
            print("No tickers found. Exiting.")
            return
        print(f"Found tickers: {tickers}")
    except Exception as e:
        print(f"Error fetching tickers: {e}")
        return

    price_queries = []
    dividend_queries = []

    # 2. Fetch data from yfinance
    for ticker_str in tickers:
        try:
            print(f"-- Processing {ticker_str} --")
            ticker = yf.Ticker(ticker_str)
            hist = ticker.history(period="5d")

            if not hist.empty:
                price = hist['Close'].iloc[-1]
                # Using parameterized queries is the best practice, but D1 API requires SQL strings.
                # We are building the strings safely as the ticker comes from our own DB.
                price_queries.append(f"INSERT INTO prices (ticker, price, last_updated) VALUES ('{ticker_str}', {price}, datetime('now')) ON CONFLICT(ticker) DO UPDATE SET price = {price}, last_updated = datetime('now');")
                print(f"  Price: {price:.2f}")

            dividends = ticker.dividends
            if not dividends.empty:
                one_year_ago = datetime.now() - timedelta(days=365)
                recent_dividends = dividends[dividends.index.tz_localize(None) > one_year_ago]
                for ex_date, amount in recent_dividends.items():
                    if amount > 0:
                        date_str = ex_date.strftime('%Y-%m-%d')
                        dividend_queries.append(f"INSERT INTO dividends (ticker, exDate, amount) VALUES ('{ticker_str}', '{date_str}', {amount}) ON CONFLICT(ticker, exDate) DO NOTHING;")
                if not recent_dividends.empty:
                    print(f"  Found {len(recent_dividends)} dividend records.")

        except Exception as e:
            print(f"  !! ERROR processing {ticker_str}: {e}")

    # 3. Execute batch queries to D1
    all_queries = price_queries + dividend_queries
    if all_queries:
        try:
            execute_d1_batch(CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, D1_DATABASE_ID, all_queries)
        except Exception as e:
            print(f"Error executing batch D1 query: {e}")

if __name__ == "__main__":
    main()
