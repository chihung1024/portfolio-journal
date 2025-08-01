# cron_worker.py
# This is a Python Cloudflare Worker that uses yfinance to update stock prices and dividends.

import yfinance as yf
import pandas as pd
import json
from datetime import datetime, timedelta

async def update_data(env):
    print("Python Cron Worker started...")
    DB = env.DB

    try:
        # 1. Get unique tickers from the transactions table
        stmt = DB.prepare("SELECT DISTINCT ticker FROM transactions")
        d1_results = await stmt.all()
        tickers = [row['ticker'] for row in d1_results['results']]

        if not tickers:
            print("No tickers found in transactions. Exiting.")
            return

        print(f"Found tickers to update: {tickers}")

        price_update_stmts = []
        dividend_update_stmts = []

        # 2. Fetch data for each ticker using yfinance
        for ticker_str in tickers:
            try:
                print(f"Fetching data for {ticker_str}...")
                ticker_obj = yf.Ticker(ticker_str)

                # Get current price
                # Use history to get the last closing price for reliability
                hist = ticker_obj.history(period="2d")
                if not hist.empty:
                    current_price = hist['Close'].iloc[-1]
                    price_update_stmts.append(
                        DB.prepare(
                            "INSERT INTO prices (ticker, price, last_updated) VALUES (?1, ?2, datetime('now')) "
                            "ON CONFLICT(ticker) DO UPDATE SET price = ?2, last_updated = datetime('now')"
                        ).bind(ticker_str, current_price)
                    )
                    print(f"  - Price for {ticker_str}: {current_price}")

                # Get dividends for the past year
                dividends = ticker_obj.dividends
                if not dividends.empty:
                    # Filter for dividends in the last 365 days
                    one_year_ago = datetime.now() - timedelta(days=365)
                    recent_dividends = dividends[dividends.index.tz_localize(None) > one_year_ago]
                    for ex_date, amount in recent_dividends.items():
                        if amount > 0:
                            ex_date_str = ex_date.strftime('%Y-%m-%d')
                            dividend_update_stmts.append(
                                DB.prepare(
                                    "INSERT INTO dividends (ticker, exDate, amount) VALUES (?1, ?2, ?3) "
                                    "ON CONFLICT(ticker, exDate) DO NOTHING"
                                ).bind(ticker_str, ex_date_str, amount)
                            )
                    print(f"  - Found {len(recent_dividends)} dividend records for {ticker_str}")

            except Exception as e:
                print(f"Could not process ticker {ticker_str}: {e}")

        # 3. Batch update the database
        if price_update_stmts:
            print(f"Updating {len(price_update_stmts)} price records...")
            await DB.batch(price_update_stmts)
        
        if dividend_update_stmts:
            print(f"Updating {len(dividend_update_stmts)} dividend records...")
            await DB.batch(dividend_update_stmts)

        print("Python Cron Worker finished successfully.")

    except Exception as e:
        print(f"An error occurred in the Python Cron Worker: {e}")

# This is the entry point for the Cloudflare Worker
export default {
    async scheduled(controller, env, ctx):
        ctx.waitUntil(update_data(env))
}
