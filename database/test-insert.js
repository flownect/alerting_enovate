/**
 * Script de test pour insérer une donnée d'exemple
 * Usage: node database/test-insert.js
 */

const { Client } = require('pg');

async function testInsert() {
    console.log('🧪 Test d\'insertion dans la BDD...\n');

    if (!process.env.DATABASE_URL) {
        console.error('❌ DATABASE_URL non définie');
        process.exit(1);
    }

    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log('✅ Connecté\n');

        // Insérer un événement de test
        console.log('📝 Insertion d\'un événement de test...');
        await client.query(`
            INSERT INTO campaigns_events 
            (campaign_id, event_type, event_subtype, csm_name, trader_name, 
             event_date, days_offset, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
            'TEST-12345',
            'launch',
            'late_launch',
            'Jerome',
            'Mustapha',
            new Date(),
            2, // J+2
            JSON.stringify({ isProgrammable: true, format: 'Interstitiel' })
        ]);
        console.log('✅ Événement inséré\n');

        // Vérifier
        console.log('🔍 Vérification...');
        const result = await client.query('SELECT * FROM campaigns_events ORDER BY created_at DESC LIMIT 1');
        console.log('\n📊 Dernier événement:');
        console.log(result.rows[0]);

        // Stats
        const stats = await client.query('SELECT * FROM v_learnings_stats');
        console.log('\n📈 Statistiques:');
        stats.rows.forEach(row => {
            console.log(`   ${row.table_name}: ${row.total_count} entrées`);
        });

        console.log('\n✨ Test réussi!');

    } catch (error) {
        console.error('\n❌ Erreur:', error.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

testInsert();
