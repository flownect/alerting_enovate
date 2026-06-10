/**
 * Script de déploiement de la base de données
 * Exécute le create-all-tables.sql sur Railway PostgreSQL
 * 
 * Usage: node database/deploy.js
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function deployDatabase() {
    console.log('🚀 Déploiement de la base de données...\n');

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

        // Lire le fichier create-all-tables.sql (contient toutes les tables dont person_emails)
        const schemaPath = path.join(__dirname, 'create-all-tables.sql');
        console.log('📄 Lecture du create-all-tables.sql...');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        console.log('✅ Schema chargé\n');

        // Exécuter le schema (split par ; et exécuter chaque requête séparément)
        console.log('⚙️  Exécution du schema...');
        const statements = schema
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--'));
        
        console.log(`   ${statements.length} instructions à exécuter...`);
        
        for (let i = 0; i < statements.length; i++) {
            const stmt = statements[i];
            try {
                await client.query(stmt);
                process.stdout.write('.');
            } catch (err) {
                console.log(`\n   ⚠️  Instruction ${i+1} ignorée: ${err.message.substring(0, 50)}`);
            }
        }
        console.log('\n✅ Schema déployé avec succès\n');

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

        // Vérifier spécifiquement person_emails
        console.log('\n📧 Vérification table person_emails:');
        try {
            const personCount = await client.query('SELECT COUNT(*) as count FROM person_emails');
            console.log(`   ${personCount.rows[0].count} personnes enregistrées`);
        } catch (e) {
            console.log('   ⚠️ Table person_emails vide ou erreur');
        }

        // Afficher les stats learnings si la vue existe
        try {
            console.log('\n📈 Statistiques Learnings:');
            const stats = await client.query('SELECT * FROM v_learnings_stats');
            stats.rows.forEach(row => {
                console.log(`   ${row.table_name}: ${row.total_count} entrées`);
            });
        } catch (e) {
            // La vue n'existe peut-être pas encore
        }

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
