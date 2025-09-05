import { closedPositionsCalculator } from '../calculation/closed_positions.calculator';

/**
 * Handles the request for closed positions data.
 * @param {object} context - The context object from the Pages function.
 * @returns {Promise<Response>} - A Response object with the closed positions data.
 */
export async function onRequestGet({ env }) {
  try {
    const closedPositions = await closedPositionsCalculator.calculate(env);

    // Add last transaction date to each closed position
    const closedPositionsWithLastDate = closedPositions.map(position => {
      const sellTransactions = position.transactions.filter(t => t.type === 'sell');
      if (sellTransactions.length === 0) {
        // This case should ideally not happen for a closed position, but as a fallback:
        return { ...position, lastTransactionDate: null };
      }

      const lastTransactionDate = sellTransactions.reduce((latest, current) => {
        const latestDate = new Date(latest.date);
        const currentDate = new Date(current.date);
        return currentDate > latestDate ? current : latest;
      }).date;

      return { ...position, lastTransactionDate };
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
