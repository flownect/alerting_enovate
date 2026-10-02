/**
 * Matching commentaires Dashboard ↔ campagnes par ID Nova uniquement.
 * campaign_comments.campaign_id = ID Nova (card.campaignId / briefId).
 */

function pushComment(map, key, comment, limit = 5) {
    if (key == null || key === '') return;
    const k = String(key);
    if (!map[k]) map[k] = [];
    if (map[k].length < limit) map[k].push(comment);
}

/**
 * @param {Array} rows - rows SQL campaign_comments
 * @param {'object'|'string'} format - object pour email HTML, string pour Slack
 */
function buildCommentsMaps(rows, format = 'object') {
    const byNovaId = {};

    for (const row of rows) {
        const comment = format === 'string'
            ? `${row.comment_text} (${row.author || 'Anonyme'})`
            : {
                comment_text: row.comment_text,
                author: row.author || 'Anonyme',
                created_at: row.created_at
            };

        pushComment(byNovaId, row.campaign_id, comment);
    }

    return { byNovaId };
}

/**
 * @param {object} maps
 * @param {string|string[]|null} novaIds - un ou plusieurs ID Nova à tester
 */
function findComments(maps, novaIds) {
    const ids = (Array.isArray(novaIds) ? novaIds : [novaIds])
        .filter(id => id != null && id !== '')
        .map(String);

    for (const id of ids) {
        if (maps.byNovaId[id]?.length) return maps.byNovaId[id];
    }
    return [];
}

module.exports = {
    buildCommentsMaps,
    findComments
};
