const fs = require('fs');
const path = require('path');

class BenchmarkMatcher {
    constructor() {
        this.benchmarks = null;
        this.loadBenchmarks();
    }

    loadBenchmarks() {
        try {
            const benchmarkPath = path.join(__dirname, '..', 'config', 'benchmarks.json');
            const data = fs.readFileSync(benchmarkPath, 'utf8');
            this.benchmarks = JSON.parse(data);
            console.log('✅ Benchmarks chargés');
        } catch (error) {
            console.error('❌ Erreur chargement benchmarks:', error.message);
            this.benchmarks = {};
        }
    }

    /**
     * Normalise le nom d'un KPI pour le matching
     * Ex: "CTR (%)" -> "ctr", "Taux de session" -> "sessionsRate"
     */
    normalizeKpiName(kpiName) {
        if (!kpiName) return null;
        
        const kpiMap = {
            'CTR': 'ctr',
            'CTR (%)': 'ctr',
            'VCR': 'vcr',
            'VCR (%)': 'vcr',
            'Taux de complétion vidéo': 'vcr',
            'Completion Rate': 'vcr',
            'Taux de session': 'sessionsRate',
            'Sessions': 'sessionsRate',
            'Taux de visite LP': 'lpVisitsRate',
            'Visite LP': 'lpVisitsRate',
            'Visites en Magasin / Taux de Visite LP': 'lpVisitsRate',
            'Taux d\'interaction LP': 'lpInteractionRate',
            'Interaction LP': 'lpInteractionRate',
            'Taux de rebond': 'bounceRate',
            'Bounce Rate': 'bounceRate',
            'Brand Safety': 'brandSafetyRate',
            'Brandsafety': 'brandSafetyRate',
            'Taux d\'interaction format': 'creaInteractionRate',
            'Interaction format': 'creaInteractionRate'
        };

        // Chercher une correspondance exacte
        for (const [key, value] of Object.entries(kpiMap)) {
            if (kpiName.toLowerCase().includes(key.toLowerCase())) {
                return value;
            }
        }

        return null;
    }

    /**
     * Extrait le format depuis le nom de la campagne ou les métadonnées
     */
    extractFormat(card) {
        // Chercher dans le nom de la campagne
        const name = (card.title || '').toLowerCase();
        
        const formats = [
            'habillage', 'grand angle', 'native', 'pavé', 'parallaxe', 
            'bannière', 'interstitiel', 'pré-roll', 'pre-roll'
        ];
        
        for (const format of formats) {
            if (name.includes(format)) {
                return format.charAt(0).toUpperCase() + format.slice(1);
            }
        }
        
        return null;
    }

    /**
     * Trouve le benchmark correspondant pour un KPI donné
     * @param {string} kpiName - Nom du KPI (ex: "CTR", "Taux de session")
     * @param {object} card - Carte Trello avec métadonnées
     * @returns {object|null} - Benchmark trouvé ou null
     */
    findBenchmark(kpiName, card) {
        const normalizedKpi = this.normalizeKpiName(kpiName);
        if (!normalizedKpi || !this.benchmarks[normalizedKpi]) {
            return null;
        }

        const rules = this.benchmarks[normalizedKpi];
        
        // Extraire les métadonnées de la carte
        const format = this.extractFormat(card);
        const device = this.extractDevice(card);
        const type = this.extractType(card);
        const feature = this.extractFeature(card);

        // Chercher la règle la plus spécifique
        let bestMatch = null;
        let bestScore = 0;

        for (const rule of rules) {
            let score = 0;
            let matches = true;

            // Vérifier format
            if (rule.format && rule.format !== 'all') {
                if (format && this.matchFormat(format, rule.format)) {
                    score += 4;
                } else if (!format) {
                    // Si pas de format détecté, on peut quand même matcher
                    score += 0;
                } else {
                    matches = false;
                }
            }

            // Vérifier device
            if (rule.device && rule.device !== 'all') {
                if (device && this.matchDevice(device, rule.device)) {
                    score += 2;
                } else if (!device) {
                    score += 0;
                } else {
                    matches = false;
                }
            }

            // Vérifier type
            if (rule.type && rule.type !== 'all') {
                if (type && this.matchType(type, rule.type)) {
                    score += 1;
                } else if (!type) {
                    score += 0;
                } else {
                    matches = false;
                }
            }

            // Vérifier feature
            if (rule.feature && rule.feature !== 'all') {
                if (feature && this.matchFeature(feature, rule.feature)) {
                    score += 1;
                } else if (!feature) {
                    score += 0;
                } else {
                    matches = false;
                }
            }

            // Si cette règle matche et a un meilleur score
            if (matches && score > bestScore) {
                bestMatch = rule;
                bestScore = score;
            }
        }

        // Si aucune règle spécifique, chercher une règle "all"
        if (!bestMatch) {
            bestMatch = rules.find(r => 
                (!r.format || r.format === 'all') &&
                (!r.device || r.device === 'all') &&
                (!r.type || r.type === 'all') &&
                (!r.feature || r.feature === 'all')
            );
        }

        return bestMatch;
    }

    /**
     * Vérifie si une performance est en dessous du benchmark
     * @param {number} value - Valeur actuelle
     * @param {object} benchmark - Benchmark avec min/max
     * @returns {object} - { belowMin: boolean, aboveMax: boolean, gap: number }
     */
    checkPerformance(value, benchmark) {
        if (!benchmark || value === null || value === undefined) {
            return { belowMin: false, aboveMax: false, gap: 0 };
        }

        const belowMin = value < benchmark.min;
        const aboveMax = value > benchmark.max;
        const gap = belowMin ? benchmark.min - value : (aboveMax ? value - benchmark.max : 0);

        return { belowMin, aboveMax, gap, benchmark };
    }

    // Méthodes de matching (à affiner selon les données Trello)
    matchFormat(cardFormat, ruleFormat) {
        return cardFormat.toLowerCase().includes(ruleFormat.toLowerCase()) ||
               ruleFormat.toLowerCase().includes(cardFormat.toLowerCase());
    }

    matchDevice(cardDevice, ruleDevice) {
        return cardDevice.toLowerCase() === ruleDevice.toLowerCase();
    }

    matchType(cardType, ruleType) {
        return cardType.toLowerCase() === ruleType.toLowerCase();
    }

    matchFeature(cardFeature, ruleFeature) {
        return cardFeature.toLowerCase().includes(ruleFeature.toLowerCase()) ||
               ruleFeature.toLowerCase().includes(cardFeature.toLowerCase());
    }

    extractDevice(card) {
        const name = (card.title || '').toLowerCase();
        if (name.includes('mobile')) return 'Mobile';
        if (name.includes('desktop')) return 'Desktop';
        return null;
    }

    extractType(card) {
        const name = (card.title || '').toLowerCase();
        if (name.includes('vidéo') || name.includes('video')) return 'Vidéo';
        if (name.includes('animé')) return 'Animé';
        if (name.includes('statique')) return 'Statique';
        return null;
    }

    extractFeature(card) {
        const name = (card.title || '').toLowerCase();
        const features = [
            'configurateur', 'gaming', 'décompte', 'carrousel', 'hotspots',
            'demi-fixe', '3d', 'grattable', 'flip', 'drag to reveal', 'cube', 'spin 360'
        ];
        
        for (const feature of features) {
            if (name.includes(feature)) {
                return feature.charAt(0).toUpperCase() + feature.slice(1);
            }
        }
        return null;
    }

    /**
     * Récupère les KPIs d'une carte (primaire et secondaire)
     * @param {object} card - Carte Trello
     * @returns {array} - Liste des KPIs [{name, type: 'primary'|'secondary'}]
     */
    getCardKpis(card) {
        const kpis = [];
        
        if (card.subdivisions && card.subdivisions.length > 0) {
            const firstSubdivision = card.subdivisions[0];
            
            if (firstSubdivision.kpi) {
                kpis.push({ name: firstSubdivision.kpi, type: 'primary' });
            }
            
            if (firstSubdivision.secondaryKpi) {
                kpis.push({ name: firstSubdivision.secondaryKpi, type: 'secondary' });
            }
        }
        
        return kpis;
    }
}

module.exports = new BenchmarkMatcher();
