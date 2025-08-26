// functions/api_handlers/batch.handler.js

// This is a simplified representation. Actual queries depend on the database schema.
const getQueryForAction = (action) => {
    const { type, entity, payload } = action;
    // Simple pluralization, may need adjustment for specific entities
    const tableName = entity.toLowerCase().endsWith('s') ? `${entity.toLowerCase()}es` : `${entity.toLowerCase()}s`;

    switch (type) {
        case 'DELETE':
            return {
                query: `DELETE FROM ${tableName} WHERE id = ?`,
                params: [payload.id]
            };

        case 'UPDATE': {
            const updatePayload = { ...payload };
            delete updatePayload.id;
            const fields = Object.keys(updatePayload);
            const setClause = fields.map(f => `${f} = ?`).join(', ');
            const params = [...fields.map(f => updatePayload[f]), payload.id];
            return {
                query: `UPDATE ${tableName} SET ${setClause} WHERE id = ?`,
                params: params
            };
        }

        case 'CREATE': {
            // For temp IDs created on the client, we need to remove them before INSERT
            const createPayload = { ...payload };
            if (String(createPayload.id).startsWith('temp_')) {
                delete createPayload.id;
            }
            const createFields = Object.keys(createPayload);
            const placeholders = createFields.map(() => '?').join(', ');
            return {
                query: `INSERT INTO ${tableName} (${createFields.join(', ')}) VALUES (${placeholders})`,
                params: Object.values(createPayload)
            };
        }
            
        default:
            throw new Error(`Unsupported action type: ${type}`);
    }
};

export async function submitBatch(req, env, ctx) {
    try {
        const actions = await req.json();

        if (!Array.isArray(actions) || actions.length === 0) {
            return new Response(JSON.stringify({ success: true, message: 'No actions to submit.' }), {
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Process actions in a safe order
        const deletes = actions.filter(a => a.type === 'DELETE');
        const updates = actions.filter(a => a.type === 'UPDATE');
        const creates = actions.filter(a => a.type === 'CREATE');

        const orderedActions = [...deletes, ...updates, ...creates];

        const statements = orderedActions.map(action => {
            const { query, params } = getQueryForAction(action);
            return env.DB.prepare(query).bind(...params);
        });

        // Execute all statements in a single transaction batch
        await env.DB.batch(statements);

        // Trigger the global recalculation on GCP
        const gcpUrl = 'https://portfolio-journal-api-951186116587.asia-east1.run.app';
        const gcpApiKey = env.GCP_API_KEY; 
        const serviceAccountKey = env.SERVICE_ACCOUNT_KEY;

        if (gcpUrl && gcpApiKey && serviceAccountKey) {
            try {
                // Based on the python script, we send a request with an action
                const response = await fetch(gcpUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-KEY': gcpApiKey,
                        'X-Service-Account-Key': serviceAccountKey
                    },
                    body: JSON.stringify({ action: 'recalculate_all_users' }) 
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error(`Failed to trigger GCP recalculation: ${response.status} ${response.statusText}`, errorText);
                } else {
                    console.log('Successfully triggered GCP recalculation.');
                }
            } catch (e) {
                console.error('Error while triggering GCP recalculation:', e);
            }
        } else {
            console.warn('GCP_API_URL, GCP_API_KEY, or SERVICE_ACCOUNT_KEY is not configured. Skipping recalculation trigger.');
        }

        return new Response(JSON.stringify({ success: true, message: 'Batch submission successful.' }), {
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error) {
        console.error('Batch submission failed:', error);
        return new Response(JSON.stringify({ success: false, message: 'Batch submission failed.', error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
