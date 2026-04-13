/**
 * Script de déploiement de la base de données
 * Exécute le schema.sql sur Railway PostgreSQL
 * 
 * Usage: node database/deploy.js
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function deployDatabase() {
    console.log('🚀 Déploiement de la base de données Learnings...\n');

    // Vérifier que DATABASE_URL existe
    if (!process.env.DATABASE_URL) {
        console.error('❌ Erreur: DATABASE_URL non définie dans les variables d\'environnement');
        console.log('\nSur Railway:');
        console.log('1. Ajoute PostgreSQL à ton projet');
        console.log('2. Copie DATABASE_URL dans les variables d\'environnement de ton service Node.js');
        process.exit(1);
    }

    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false // Railway nécessite SSL
        }
    });

    try {
        // Connexion
        console.log('📡 Connexion à PostgreSQL...');
        await client.connect();
        console.log('✅ Connecté\n');

        // Lire le fichier schema.sql
        const schemaPath = path.join(__dirname, 'schema.sql');
        console.log('📄 Lecture du schema.sql...');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        console.log('✅ Schema chargé\n');

        // Exécuter le schema
        console.log('⚙️  Exécution du schema...');
        await client.query(schema);
        console.log('✅ Schema déployé avec succès\n');

        // Vérifier les tables créées
        console.log('🔍 Vérification des tables...');
        const result = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_type = 'BASE TABLE'
            ORDER BY table_name;
        `);

        console.log('\n📊 Tables créées:');
        result.rows.forEach(row => {
            console.log(`   ✓ ${row.table_name}`);
        });

        // Afficher les stats
        console.log('\n📈 Statistiques:');
        const stats = await client.query('SELECT * FROM v_learnings_stats');
        stats.rows.forEach(row => {
            console.log(`   ${row.table_name}: ${row.total_count} entrées`);
        });

        console.log('\n✨ Déploiement terminé avec succès!');

    } catch (error) {
        console.error('\n❌ Erreur lors du déploiement:', error.message);
        console.error('\nDétails:', error);
        process.exit(1);
    } finally {
        await client.end();
    }
}

// Exécuter
deployDatabase();
