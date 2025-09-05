import { closedPositionsCalculator } from '../calculation/closed_positions.calculator';

/**
 * Handles the request for closed positions data.
 * @param {object} context - The context object from the Pages function.
 * @returns {Promise<Response>} - A Response object with the closed positions data.
 */
export async function onRequestGet(context) {
  try {
    const { env } = context;
    const closedPositions = await closedPositionsCalculator.calculate(env);

    // Add last transaction date to each closed position
    const closedPositionsWithLastDate = closedPositions.map(position => {
      const sellTransactions = position.transactions.filter(t => t.type === 'sell');

      if (sellTransactions.length === 0) {
        // This should not happen for a closed position, but as a robust fallback:
        return { ...position, lastTransactionDate: null };
      }

      // Sort transactions by date descending to find the most recent one.
      // This approach is more robust and readable than using reduce().
      const lastTransaction = sellTransactions.sort((a, b) => new Date(b.date) - new Date(a.date))[0];

      return { ...position, lastTransactionDate: lastTransaction.date };
    });

    const response = {
      success: true,
      data: closedPositionsWithLastDate,
    };

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error fetching closed positions:', error);
    const errorResponse = {
      success: false,
      message: 'Failed to fetch closed positions',
      error: error.message,
    };
    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
