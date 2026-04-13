/**
 * Déploiement du schema simplifié
 * Usage: node database/deploy-simple.js
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function deploySimpleSchema() {
    console.log('🚀 Déploiement du schema simplifié...\n');

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

        const schemaPath = path.join(__dirname, 'schema-simple.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        
        console.log('⚙️  Exécution du schema...');
        await client.query(schema);
        console.log('✅ Schema déployé\n');

        // Vérifier
        const tables = await client.query(`
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        `);
        
        console.log('📊 Tables:');
        tables.rows.forEach(row => console.log(`   ✓ ${row.table_name}`));

        const views = await client.query(`
            SELECT table_name FROM information_schema.views 
            WHERE table_schema = 'public'
        `);
        
        console.log('\n📊 Vues:');
        views.rows.forEach(row => console.log(`   ✓ ${row.table_name}`));

        console.log('\n✨ Déploiement terminé!');

    } catch (error) {
        console.error('\n❌ Erreur:', error.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

deploySimpleSchema();
