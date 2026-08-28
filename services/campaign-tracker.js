/**
 * CampaignTracker — système fiable de suivi par diff (snapshots + events)
 * Agrège par tracker_id, détecte les changements, alimente stats et exports.
 */

const crypto = require('crypto');
const { Client } = require('pg');

const TRACKED_FIELDS = [
    'is_programmable', 'is_programmed', 'is_live', 'is_checked',
    'is_priority', 'has_bilan_missing', 'trader_name', 'csm_name',
    'commercial_name', 'lane_id'
];

const FIELD_EVENT_MAP = {
    is_programmable: { true: 'became_programmable', false: 'became_non_programmable' },
    is_programmed: { true: 'became_programmed', false: 'became_unprogrammed' },
    is_live: { true: 'became_live', false: 'became_offline' },
    is_checked: { true: 'checked', false: 'unchecked' },
    is_priority: { true: 'priority_on', false: 'priority_off' },
    has_bilan_missing: { true: 'bilan_missing', false: 'bilan_ok' },
    trader_name: 'trader_changed',
    csm_name: 'csm_changed',
    commercial_name: 'commercial_changed',
    lane_id: 'lane_changed'
};

const ENSURE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS campaign_snapshots (
    tracker_key VARCHAR(50) PRIMARY KEY,
    tracker_id VARCHAR(50),
    campaign_id VARCHAR(50),
    campaign_name TEXT,
    commercial_name VARCHAR(100),
    csm_name VARCHAR(100),
    trader_name VARCHAR(100),
    is_programmable BOOLEAN DEFAULT false,
    is_programmed BOOLEAN DEFAULT false,
    is_live BOOLEAN DEFAULT false,
    is_checked BOOLEAN DEFAULT false,
    is_priority BOOLEAN DEFAULT false,
    has_bilan_missing BOOLEAN DEFAULT false,
    lane_id VARCHAR(20),
    campaign_start DATE,
    campaign_end DATE,
    snapshot_hash VARCHAR(64),
    first_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS campaign_events (
    id BIGSERIAL PRIMARY KEY,
    tracker_key VARCHAR(50) NOT NULL,
    tracker_id VARCHAR(50),
    campaign_id VARCHAR(50),
    campaign_name TEXT,
    trader_name VARCHAR(100),
    csm_name VARCHAR(100),
    commercial_name VARCHAR(100),
    event_type VARCHAR(30) NOT NULL,
    old_value VARCHAR(50),
    new_value VARCHAR(50),
    detected_at TIMESTAMP NOT NULL DEFAULT NOW(),
    days_before_launch INT,
    campaign_start DATE,
    campaign_end DATE,
    delay_bucket VARCHAR(20),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_snapshots_tracker ON campaign_snapshots(tracker_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_last_seen ON campaign_snapshots(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_detected ON campaign_events(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_tracker_key ON campaign_events(tracker_key);
CREATE INDEX IF NOT EXISTS idx_events_type_date ON campaign_events(event_type, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_trader ON campaign_events(trader_name, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_csm ON campaign_events(csm_name, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_commercial ON campaign_events(commercial_name, detected_at DESC);
`;

class CampaignTracker {
    constructor(databaseUrl) {
        this.databaseUrl = databaseUrl;
        this.client = null;
    }

    async connect() {
        this.client = new Client({
            connectionString: this.databaseUrl,
            ssl: { rejectUnauthorized: false }
        });
        await this.client.connect();
        await this.ensureSchema();
    }

    async ensureSchema() {
        const statements = ENSURE_SCHEMA_SQL
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);
        for (const stmt of statements) {
            await this.client.query(stmt);
        }
    }

    async disconnect() {
        if (this.client) await this.client.end();
    }

    // ─── Helpers ───────────────────────────────────────────────

    normalizePerson(name) {
        if (!name) return null;
        const trimmed = name.trim();
        if (trimmed.toLowerCase() === 'aucun') return null;
        return trimmed;
    }

    getFirstTrader(traderField) {
        if (!traderField) return null;
        return traderField.split(/\s+-\s+/)[0].trim() || null;
    }

    parseDate(dateStr) {
        if (!dateStr) return null;
        if (typeof dateStr === 'string' && dateStr.includes('/')) {
            const [day, month, year] = dateStr.split('/');
            return new Date(year, month - 1, day);
        }
        const d = new Date(dateStr);
        return isNaN(d.getTime()) ? null : d;
    }

    formatDate(d) {
        if (!d) return null;
        const date = d instanceof Date ? d : new Date(d);
        if (isNaN(date.getTime())) return null;
        return date.toISOString().split('T')[0];
    }

    hasTag(card, tagTitle) {
        return card.tags?.some(t =>
            t.title?.toLowerCase().includes(tagTitle.toLowerCase())
        ) ?? false;
    }

    daysBeforeLaunch(campaignStart, detectedAt) {
        if (!campaignStart || !detectedAt) return null;
        const start = campaignStart instanceof Date ? campaignStart : new Date(campaignStart);
        const detected = detectedAt instanceof Date ? detectedAt : new Date(detectedAt);
        const d1 = new Date(detected.getFullYear(), detected.getMonth(), detected.getDate());
        const d2 = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
    }

    delayBucket(days) {
        if (days === null || days === undefined) return null;
        if (days < 0) return 'after_launch';
        if (days === 0) return 'j0';
        if (days === 1) return 'j1';
        if (days === 2) return 'j2';
        if (days === 3) return 'j3';
        return 'j3_plus';
    }

    computeHash(state) {
        const payload = {};
        for (const f of TRACKED_FIELDS) payload[f] = state[f] ?? null;
        return crypto.createHash('md5').update(JSON.stringify(payload)).digest('hex');
    }

    // ─── Agrégation Trello par tracker_key ─────────────────────

    aggregateCards(trelloData) {
        const lanes = trelloData?.data?.lanes || trelloData?.lanes || [];
        const map = new Map();

        for (const lane of lanes) {
            if (!lane.cards) continue;
            for (const card of lane.cards) {
                const trackerKey = card.trackerId || card.campaignId;
                if (!trackerKey) continue;

                let agg = map.get(trackerKey);
                if (!agg) {
                    agg = {
                        tracker_key: trackerKey,
                        tracker_id: card.trackerId || null,
                        campaign_id: card.campaignId || null,
                        campaign_name: card.title || card.name || null,
                        commercial_name: null,
                        csm_name: null,
                        trader_name: null,
                        is_programmable: false,
                        is_programmed: false,
                        is_live: false,
                        is_checked: false,
                        is_priority: false,
                        has_bilan_missing: false,
                        lane_id: card.laneId || null,
                        campaign_start: null,
                        campaign_end: null
                    };
                }

                agg.is_programmable = agg.is_programmable || card.isProgrammable === true;
                agg.is_programmed = agg.is_programmed ||
                    card.areSubdivisionsProgrammed === true ||
                    !!card.trackerId;
                agg.is_live = agg.is_live ||
                    card.areSubdivisionsLive === true ||
                    card.laneId === 'lane3';
                if (card.areSubdivisionsLive === true && card.areSubdivisionsChecked === true) {
                    agg.is_checked = true;
                }
                agg.is_priority = agg.is_priority || card.flaggedAsImportant === true;
                agg.has_bilan_missing = agg.has_bilan_missing ||
                    (this.hasTag(card, 'Terminé') && this.hasTag(card, 'Bilan non saisi'));

                const commercial = this.normalizePerson(card.commercial);
                const csm = this.normalizePerson(card.accountManager);
                const trader = this.getFirstTrader(card.trader);
                if (commercial) agg.commercial_name = commercial;
                if (csm) agg.csm_name = csm;
                if (trader) agg.trader_name = trader;
                if (card.title) agg.campaign_name = card.title;
                if (card.laneId) agg.lane_id = card.laneId;

                const start = this.parseDate(card.dates?.startingDateFormatted);
                const end = this.parseDate(card.dates?.endingDateFormatted);
                if (start) agg.campaign_start = start;
                if (end) agg.campaign_end = end;

                map.set(trackerKey, agg);
            }
        }

        return map;
    }

    snapshotToState(row) {
        if (!row) return null;
        return {
            is_programmable: row.is_programmable,
            is_programmed: row.is_programmed,
            is_live: row.is_live,
            is_checked: row.is_checked,
            is_priority: row.is_priority,
            has_bilan_missing: row.has_bilan_missing,
            trader_name: row.trader_name,
            csm_name: row.csm_name,
            commercial_name: row.commercial_name,
            lane_id: row.lane_id
        };
    }

    // ─── Cycle principal ───────────────────────────────────────

    async trackChanges(trelloData) {
        const stats = { total: 0, skipped: 0, events: 0, discovered: 0 };

        try {
            await this.connect();
            const aggregated = this.aggregateCards(trelloData);
            stats.total = aggregated.size;
            const now = new Date();

            for (const [trackerKey, current] of aggregated) {
                const hash = this.computeHash(current);

                const existing = await this.client.query(
                    'SELECT * FROM campaign_snapshots WHERE tracker_key = $1',
                    [trackerKey]
                );

                if (existing.rows.length === 0) {
                    await this.insertSnapshot(current, hash, now);
                    await this.insertEvent(current, 'discovered', null, null, now);
                    stats.discovered++;
                    stats.events++;
                    continue;
                }

                const snapshot = existing.rows[0];
                if (snapshot.snapshot_hash === hash) {
                    await this.client.query(
                        'UPDATE campaign_snapshots SET last_seen_at = $1 WHERE tracker_key = $2',
                        [now, trackerKey]
                    );
                    stats.skipped++;
                    continue;
                }

                const oldState = this.snapshotToState(snapshot);
                const eventCount = await this.detectAndLogEvents(current, oldState, now);
                stats.events += eventCount;
                await this.updateSnapshot(current, hash, now);
            }

            return stats;
        } finally {
            await this.disconnect();
        }
    }

    async insertSnapshot(state, hash, now) {
        await this.client.query(`
            INSERT INTO campaign_snapshots (
                tracker_key, tracker_id, campaign_id, campaign_name,
                commercial_name, csm_name, trader_name,
                is_programmable, is_programmed, is_live, is_checked,
                is_priority, has_bilan_missing, lane_id,
                campaign_start, campaign_end, snapshot_hash,
                first_seen_at, last_seen_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18)
        `, [
            state.tracker_key, state.tracker_id, state.campaign_id, state.campaign_name,
            state.commercial_name, state.csm_name, state.trader_name,
            state.is_programmable, state.is_programmed, state.is_live, state.is_checked,
            state.is_priority, state.has_bilan_missing, state.lane_id,
            this.formatDate(state.campaign_start), this.formatDate(state.campaign_end),
            hash, now
        ]);
    }

    async updateSnapshot(state, hash, now) {
        await this.client.query(`
            UPDATE campaign_snapshots SET
                tracker_id = $2, campaign_id = $3, campaign_name = $4,
                commercial_name = $5, csm_name = $6, trader_name = $7,
                is_programmable = $8, is_programmed = $9, is_live = $10,
                is_checked = $11, is_priority = $12, has_bilan_missing = $13,
                lane_id = $14, campaign_start = $15, campaign_end = $16,
                snapshot_hash = $17, last_seen_at = $18
            WHERE tracker_key = $1
        `, [
            state.tracker_key, state.tracker_id, state.campaign_id, state.campaign_name,
            state.commercial_name, state.csm_name, state.trader_name,
            state.is_programmable, state.is_programmed, state.is_live, state.is_checked,
            state.is_priority, state.has_bilan_missing, state.lane_id,
            this.formatDate(state.campaign_start), this.formatDate(state.campaign_end),
            hash, now
        ]);
    }

    async detectAndLogEvents(current, oldState, now) {
        let count = 0;

        for (const field of TRACKED_FIELDS) {
            const oldVal = oldState[field];
            const newVal = current[field];

            if (oldVal === newVal) continue;
            if (oldVal == null && newVal == null) continue;

            let eventType;
            if (typeof FIELD_EVENT_MAP[field] === 'object') {
                eventType = FIELD_EVENT_MAP[field][String(!!newVal)];
                if (!eventType) continue;
            } else {
                eventType = FIELD_EVENT_MAP[field];
            }

            await this.insertEvent(current, eventType, String(oldVal ?? ''), String(newVal ?? ''), now);
            count++;
        }

        return count;
    }

    async insertEvent(state, eventType, oldValue, newValue, detectedAt) {
        const dup = await this.client.query(`
            SELECT id FROM campaign_events
            WHERE tracker_key = $1 AND event_type = $2
              AND detected_at >= $3::timestamp - INTERVAL '1 hour'
            LIMIT 1
        `, [state.tracker_key, eventType, detectedAt]);

        if (dup.rows.length > 0) return;

        let daysBefore = null;
        let bucket = null;
        if (eventType === 'became_programmable') {
            daysBefore = this.daysBeforeLaunch(state.campaign_start, detectedAt);
            bucket = this.delayBucket(daysBefore);
        }

        await this.client.query(`
            INSERT INTO campaign_events (
                tracker_key, tracker_id, campaign_id, campaign_name,
                trader_name, csm_name, commercial_name,
                event_type, old_value, new_value, detected_at,
                days_before_launch, campaign_start, campaign_end, delay_bucket
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        `, [
            state.tracker_key, state.tracker_id, state.campaign_id, state.campaign_name,
            state.trader_name, state.csm_name, state.commercial_name,
            eventType, oldValue, newValue, detectedAt,
            daysBefore, this.formatDate(state.campaign_start),
            this.formatDate(state.campaign_end), bucket
        ]);
    }

    // ─── Health check ──────────────────────────────────────────

    async getHealth() {
        try {
            await this.connect();

            const tables = await this.client.query(`
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_name IN ('campaign_snapshots', 'campaign_events')
            `);
            const tableNames = tables.rows.map(r => r.table_name);
            const tablesReady = tableNames.includes('campaign_snapshots')
                && tableNames.includes('campaign_events');

            if (!tablesReady) {
                return {
                    status: 'not_ready',
                    tables: { campaign_snapshots: false, campaign_events: false },
                    message: 'Tables manquantes — redémarrer l\'app pour lancer initializeDatabase()'
                };
            }

            const counts = await this.client.query(`
                SELECT
                    (SELECT COUNT(*)::int FROM campaign_snapshots) AS snapshots,
                    (SELECT COUNT(*)::int FROM campaign_events) AS events,
                    (SELECT MAX(last_seen_at) FROM campaign_snapshots) AS last_scan,
                    (SELECT MAX(detected_at) FROM campaign_events) AS last_event,
                    (SELECT COUNT(*)::int FROM campaign_events
                     WHERE event_type = 'became_programmable'
                       AND detected_at >= NOW() - INTERVAL '30 days') AS programmable_30d
            `);

            const byType = await this.client.query(`
                SELECT event_type, COUNT(*)::int AS count
                FROM campaign_events
                GROUP BY event_type
                ORDER BY count DESC
            `);

            const row = counts.rows[0];
            const trackingRan = row.snapshots > 0;
            const lastScan = row.last_scan ? new Date(row.last_scan) : null;
            const minutesSinceScan = lastScan
                ? Math.round((Date.now() - lastScan.getTime()) / 60000)
                : null;

            let status = 'healthy';
            if (!trackingRan) {
                status = 'waiting';
            } else if (minutesSinceScan > 24 * 60) {
                status = 'stale';
            }

            return {
                status,
                tables: { campaign_snapshots: true, campaign_events: true },
                tracking: {
                    ran: trackingRan,
                    snapshots: row.snapshots,
                    events: row.events,
                    last_scan: row.last_scan,
                    last_event: row.last_event,
                    minutes_since_scan: minutesSinceScan,
                    programmable_transitions_30d: row.programmable_30d
                },
                events_by_type: Object.fromEntries(
                    byType.rows.map(r => [r.event_type, r.count])
                )
            };
        } finally {
            await this.disconnect();
        }
    }

    // ─── Stats programmation (agrégation dynamique) ────────────

    async getProgrammingStats(period = '30d', groupBy = 'csm') {
        const intervalDays = period === '90d' ? 90 : 30;
        const groupField = groupBy === 'commercial' ? 'commercial_name' : 'csm_name';

        try {
            await this.connect();

            const result = await this.client.query(`
                SELECT
                    ${groupField} AS name,
                    COUNT(*) AS total_transitions,
                    COUNT(*) FILTER (WHERE delay_bucket = 'after_launch') AS after_launch,
                    COUNT(*) FILTER (WHERE delay_bucket = 'j0') AS j0,
                    COUNT(*) FILTER (WHERE delay_bucket = 'j1') AS j1,
                    COUNT(*) FILTER (WHERE delay_bucket = 'j2') AS j2,
                    COUNT(*) FILTER (WHERE delay_bucket = 'j3') AS j3,
                    COUNT(*) FILTER (WHERE delay_bucket = 'j3_plus') AS j3_plus,
                    MAX(detected_at) AS last_transition
                FROM campaign_events
                WHERE event_type = 'became_programmable'
                  AND detected_at >= NOW() - INTERVAL '${intervalDays} days'
                  AND ${groupField} IS NOT NULL
                GROUP BY ${groupField}
                ORDER BY COUNT(*) FILTER (WHERE delay_bucket IN ('after_launch','j0','j1','j2')) DESC,
                         COUNT(*) DESC
            `);

            return result.rows;
        } finally {
            await this.disconnect();
        }
    }

    /** État actuel depuis les snapshots (disponible immédiatement, sans historique) */
    async getCurrentSnapshotStats(groupBy = 'csm') {
        const groupField = groupBy === 'commercial' ? 'commercial_name' : 'csm_name';

        try {
            await this.connect();

            const result = await this.client.query(`
                SELECT
                    ${groupField} AS name,
                    COUNT(*)::int AS total_tracked,
                    COUNT(*) FILTER (WHERE is_programmable)::int AS programmable_now,
                    COUNT(*) FILTER (WHERE is_programmed)::int AS programmed_now,
                    COUNT(*) FILTER (WHERE is_live)::int AS live_now,
                    MAX(last_seen_at) AS last_seen
                FROM campaign_snapshots
                WHERE ${groupField} IS NOT NULL
                GROUP BY ${groupField}
                ORDER BY COUNT(*) FILTER (WHERE is_programmable) DESC, COUNT(*) DESC
            `);

            return result.rows;
        } finally {
            await this.disconnect();
        }
    }

    // ─── Export détail par période ─────────────────────────────

    async getExportDetail({ period = '30d', groupBy = 'csm', person = null, eventType = 'became_programmable' }) {
        const intervalDays = period === '90d' ? 90 : period === '7d' ? 7 : 30;
        const groupField = groupBy === 'commercial' ? 'commercial_name'
            : groupBy === 'trader' ? 'trader_name' : 'csm_name';

        try {
            await this.connect();

            const params = [eventType];
            let personFilter = '';
            if (person) {
                params.push(person);
                personFilter = `AND ${groupField} = $${params.length}`;
            }

            const result = await this.client.query(`
                SELECT
                    tracker_id, tracker_key, campaign_name,
                    commercial_name, csm_name, trader_name,
                    event_type, detected_at,
                    days_before_launch, delay_bucket,
                    campaign_start, campaign_end
                FROM campaign_events
                WHERE event_type = $1
                  AND detected_at >= NOW() - INTERVAL '${intervalDays} days'
                  AND ${groupField} IS NOT NULL
                  ${personFilter}
                ORDER BY ${groupField}, detected_at DESC
            `, params);

            return result.rows;
        } finally {
            await this.disconnect();
        }
    }

    // ─── Fil d'activité (sidebar) ──────────────────────────────

    async getActivityLog({ limit = 50, period = '7d', trader = null, traders = null, includeDiscovered = false, eventTypes = null }) {
        const intervalDays = period === '30d' ? 30 : period === '1d' ? 1 : 7;
        const safeLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 200);

        try {
            await this.connect();

            const params = [];
            const conditions = [`detected_at >= NOW() - INTERVAL '${intervalDays} days'`];

            if (!includeDiscovered) {
                conditions.push(`event_type != 'discovered'`);
            }

            if (eventTypes && eventTypes.length > 0) {
                params.push(eventTypes);
                conditions.push(`event_type = ANY($${params.length})`);
            }

            if (trader) {
                params.push(trader);
                conditions.push(`trader_name = $${params.length}`);
            } else if (traders && traders.length > 0) {
                params.push(traders);
                conditions.push(`trader_name = ANY($${params.length})`);
            }

            params.push(safeLimit);
            const limitParam = `$${params.length}`;

            const result = await this.client.query(`
                SELECT
                    id, tracker_id, tracker_key, campaign_id, campaign_name,
                    trader_name, csm_name, commercial_name,
                    event_type, old_value, new_value,
                    detected_at, days_before_launch, delay_bucket
                FROM campaign_events
                WHERE ${conditions.join(' AND ')}
                ORDER BY detected_at DESC
                LIMIT ${limitParam}
            `, params);

            return result.rows;
        } finally {
            await this.disconnect();
        }
    }

    buildCsv(rows) {
        const headers = [
            'Tracker ID', 'Campagne', 'Commercial', 'CSM', 'Trader',
            'Événement', 'Date détection', 'Jours avant lancement',
            'Bucket', 'Date début', 'Date fin'
        ];
        const lines = [headers.join(';')];

        for (const r of rows) {
            lines.push([
                r.tracker_id || r.tracker_key || '',
                this.csvEscape(r.campaign_name),
                this.csvEscape(r.commercial_name),
                this.csvEscape(r.csm_name),
                this.csvEscape(r.trader_name),
                r.event_type || '',
                r.detected_at ? new Date(r.detected_at).toISOString() : '',
                r.days_before_launch ?? '',
                r.delay_bucket || '',
                r.campaign_start ? new Date(r.campaign_start).toISOString().split('T')[0] : '',
                r.campaign_end ? new Date(r.campaign_end).toISOString().split('T')[0] : ''
            ].join(';'));
        }

        return '\uFEFF' + lines.join('\n');
    }

    csvEscape(val) {
        if (!val) return '';
        const s = String(val);
        return s.includes(';') || s.includes('"') || s.includes('\n')
            ? `"${s.replace(/"/g, '""')}"` : s;
    }

    async getDistinctPersons(groupBy = 'csm', period = '30d') {
        const intervalDays = period === '90d' ? 90 : 30;
        const groupField = groupBy === 'commercial' ? 'commercial_name'
            : groupBy === 'trader' ? 'trader_name' : 'csm_name';

        try {
            await this.connect();
            const result = await this.client.query(`
                SELECT DISTINCT ${groupField} AS name
                FROM campaign_events
                WHERE event_type = 'became_programmable'
                  AND detected_at >= NOW() - INTERVAL '${intervalDays} days'
                  AND ${groupField} IS NOT NULL
                ORDER BY ${groupField}
            `);
            return result.rows.map(r => r.name);
        } finally {
            await this.disconnect();
        }
    }
}

module.exports = CampaignTracker;
