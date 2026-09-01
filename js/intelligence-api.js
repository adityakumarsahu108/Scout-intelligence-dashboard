/**
 * Security Intelligence API
 *
 * Standalone API client for the Intelligence page.
 * Does NOT depend on dashboard.js.
 */

const INTELLIGENCE_API_BASE =
    'https://dailyreportgenbackend.adityakumarsahu108.workers.dev';


async function intelligenceRequest(endpoint) {

    const response = await fetch(
        `${INTELLIGENCE_API_BASE}${endpoint}`,
        {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        }
    );

    if (!response.ok) {

        const errorText =
            await response.text();

        throw new Error(
            `Intelligence API failed: ${response.status} ${errorText}`
        );
    }

    return await response.json();
}


/**
 * Get the complete Intelligence Summary.
 *
 * GET /api/v1/intelligence/summary
 */
async function getIntelligenceSummary() {

    return intelligenceRequest(
        '/api/v1/intelligence/summary'
    );

}


/**
 * Public Intelligence API
 */
window.IntelligenceAPI = {

    getSummary: getIntelligenceSummary

};