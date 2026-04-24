// ============================================
// BILAN - Génération de bilans campagne
// ============================================
// Tunnel : 
//   1. Saisie ID campagne → récupération stats via API
//   2. Affichage tableau des stats
//   3. Sélection/import template → remplissage via API Claude (proxy Railway)
//   4. Export du bilan final
//
// Les clés API (Claude, etc.) sont stockées côté Railway (env vars)
// Le client ne voit jamais les clés — tout passe par /api/bilan/*

// ============================================
// DONNÉES GLOBALES
// ============================================
const bilanData = {
    title: '',                 // Titre du bilan
    objectif: '',              // Objectif (valeur numérique)
    cpc: '',                   // CPC / CPM (valeur numérique)
    date: '',                  // Date (texte libre, ex: "DU 01/01 AU 31/01/2026")
    sourceMode: 'api',          // Mode API uniquement
    campaignIds: '',           // IDs campagne séparés par virgule (mode API)
    novaId: '',                // ID Nova (pour récupérer les infos campagne)
    novaRawData: null,         // Données brutes Nova complètes
    dateFrom: '',              // Date début API (YYYY-MM-DD)
    dateTo: '',                // Date fin API (YYYY-MM-DD)
    selectedStatFields: [],    // Champs statistiques sélectionnés (mode API)
    selectedViews: ['global', 'formats', 'ciblages'], // Vues API sélectionnées (global/formats/ciblages/creatives)
    multiObjectifs: false,      // Multi objectifs (breakdown par objectiveName)
    selectedObjective: 'all',   // Objectif sélectionné ('all'=tous, ou nom spécifique)
    objectivesMapping: {},      // Mapping objectiveName -> objectiveId (chargé via loadObjectives)
    detailCiblage: false,       // Détail par ciblage (Data Adsquare, Sirdata, etc.)
    apiStatFieldsConfig: null, // Config chargée depuis api_statistic_fields.json
    statsFiles: [],            // [{name, headers, rows, kpis, sheetName}]
    selectedTemplate: null,    // Template sélectionné
    selectedTemplatePath: null,// Chemin serveur du template sélectionné
    customTemplateFile: null,  // Fichier template Excel uploadé
    templateData: null,        // Données parsées du template
    generatedBilan: null,      // Bilan généré par Claude
    subdivisions: '',          // Bloc A : Info Subdivisions (texte structuré)
    topDiffPerf: '',           // Bloc B : Tableau brut Top Diff / Top Perf
    _commentsLoaded: false,    // Flag: commentaires ADX chargés ?
    _commentsCleanConfirmed: false, // Flag: popup nettoyage déjà confirmée ?
    customPrompt: '',          // Instructions supplémentaires pour Claude
    wantAnalysis: false,       // Veut une analyse Claude ?
    analysisType: 'simple',    // 'simple' ou 'pousse'
    analysisContext: '',       // Contexte optionnel pour l'analyse
    analysisContextPerCampaign: {}, // Commentaires par campagne (multi-campagnes)
    campaignList: [],          // Liste des campagnes {id, name} depuis l'API
    analysisResult: null,      // Résultat de l'analyse Claude
    step: 1                    // Étape courante du tunnel
};

/**
 * Convertit un index (row, col) en référence cellule Excel (ex: B5)
 */
function getCellRef(rowIndex, colIndex) {
    let col = '';
    let n = colIndex;
    do {
        col = String.fromCharCode(65 + (n % 26)) + col;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return col + (rowIndex + 1);
}

/**
 * Détermine si une cellule contient une valeur de données (modifiable) ou un label structurel (contexte)
 * Retourne 'editable' ou 'context'
 */
function classifyCell(value) {
    const s = String(value).trim();
    
    // Nombre pur (avec ou sans séparateurs)
    if (/^-?[\d\s.,]+[€%]?$/.test(s) && /\d/.test(s)) return 'editable';
    
    // Date (JJ/MM/AAAA, AAAA-MM-JJ, etc.)
    if (/^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(s)) return 'editable';
    if (/^\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}$/.test(s)) return 'editable';
    
    // Placeholders évidents (XX, 0, -, N/A, etc.)
    if (/^[X0\-\/]+$/.test(s) || s === 'N/A' || s === 'n/a' || s === '-') return 'editable';
    
    // "DU ... AU ..." = champ de période modifiable
    if (/^du\s/i.test(s) && /au\s/i.test(s)) return 'editable';
    
    // Texte contenant "XX" comme placeholder
    if (/XX/i.test(s)) return 'editable';
    
    // Tout le reste = label/titre structurel (contexte)
    return 'context';
}

/**
 * Extrait la carte des cellules du template, catégorisées en 'editable' et 'context'
 * Retourne { "NomFeuille": { context: [{ref, value}], editable: [{ref, value}] } }
 */
function extractEditableCells(templateData) {
    const cellMap = {};
    
    for (const [sheetName, rows] of Object.entries(templateData)) {
        cellMap[sheetName] = { context: [], editable: [] };
        rows.forEach((row, rowIdx) => {
            row.forEach((cell, colIdx) => {
                const cellStr = String(cell || '').trim();
                // Exclure les cellules vides et les formules
                if (!cellStr || cellStr.startsWith('=')) return;
                
                const category = classifyCell(cellStr);
                cellMap[sheetName][category].push({
                    ref: getCellRef(rowIdx, colIdx),
                    value: cellStr
                });
            });
        });
    }
    return cellMap;
}

// ============================================
// INITIALISATION
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    initBilan();
});

function initBilan() {
    const container = document.getElementById('bilanContainer');
    if (!container) return;
    renderBilanStep1();
}

/**
 * Raccourci de période : met à jour les champs date début/fin
 */
function setBilanDateRange(amount, unit) {
    const end = new Date();
    const start = new Date();
    if (unit === 'days') {
        start.setDate(start.getDate() - amount);
    } else if (unit === 'months') {
        start.setMonth(start.getMonth() - amount);
    }
    const fromEl = document.getElementById('bilanDateFrom');
    const toEl = document.getElementById('bilanDateTo');
    if (fromEl) fromEl.value = start.toISOString().split('T')[0];
    if (toEl) toEl.value = end.toISOString().split('T')[0];
}

// ============================================
// RESET COMPLET — vider toutes les données et caches
// ============================================
function resetBilanData() {
    bilanData.title = '';
    bilanData.objectif = '';
    bilanData.cpc = '';
    bilanData.date = '';
    bilanData.sourceMode = 'api';
    bilanData.campaignIds = '';
    bilanData.novaId = '';
    bilanData.novaRawData = null;
    bilanData.dateFrom = '';
    bilanData.dateTo = '';
    bilanData.selectedStatFields = [];
    bilanData.selectedViews = ['global', 'formats', 'ciblages'];
    bilanData.multiObjectifs = false;
    bilanData.detailCiblage = false;
    bilanData.apiStatFieldsConfig = null;
    bilanData.statsFiles = [];
    bilanData.selectedTemplate = null;
    bilanData.selectedTemplatePath = null;
    bilanData.customTemplateFile = null;
    bilanData.templateData = null;
    bilanData.generatedBilan = null;
    bilanData.subdivisions = '';
    bilanData.topDiffPerf = '';
    bilanData.customPrompt = '';
    bilanData.wantAnalysis = false;
    bilanData.analysisType = 'simple';
    bilanData.analysisContext = '';
    bilanData.analysisContextPerCampaign = {};
    bilanData.campaignList = [];
    bilanData.analysisResult = null;
    bilanData.totalReachUsers = 0;
    bilanData.step = 1;
    // Caches internes
    bilanData._commentsLoaded = false;
    bilanData._commentsCleanConfirmed = false;
    bilanData._kpiLibrary = null;
    bilanData._subdivisionsList = null;
    bilanData._subdivisions = null;
    bilanData._apiRawHeaders = null;
    bilanData._apiRawRows = null;
    bilanData._apiRawRecords = null;
    bilanData._apiViews = null;
    bilanData._aggregatedData = null;
    bilanData._aggBase64 = null;
    bilanData._aggFileName = null;
    bilanData._pousseContext = null;
}

// ============================================
// ÉTAPE 1 : SAISIE ID CAMPAGNE
// ============================================
function renderBilanStep1(skipReset) {
    if (!skipReset) resetBilanData();
    bilanData.step = 1;
    const container = document.getElementById('bilanContainer');
    if (!container) return;
    
    const today = new Date().toISOString().split('T')[0];
    const d3m = new Date(); d3m.setMonth(d3m.getMonth() - 3);
    const threeMonthsAgo = d3m.toISOString().split('T')[0];
    bilanData.sourceMode = 'api';
    
    container.innerHTML = `
        <div class="bilan-container">
            <div class="bilan-header">
                <div class="bilan-header-icon">📑</div>
                <h2>Bilan Campagne</h2>
                <p>Générez automatiquement le bilan de votre campagne à partir de ses statistiques.</p>
                <button onclick="renderScheduledReports()" style="margin-top:8px;background:none;border:1px solid rgba(102,126,234,0.3);color:#667eea;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:0.82em;font-family:inherit;transition:all .2s;" onmouseover="this.style.background='rgba(102,126,234,0.08)'" onmouseout="this.style.background='none'">⏰ Rapports automatiques</button>
            </div>

            ${renderStepper(1)}

            <div class="bilan-card">
                <h3>
                    <span class="bilan-step-number">1</span>
                    Paramètres API
                </h3>

                <div class="bilan-form-group">
                    <label>ID Nova</label>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <input type="text" id="bilanNovaId" class="bilan-input" value="${bilanData.novaId}" 
                            placeholder="Ex : 12345" style="flex:1;">
                        <button onclick="fetchNovaInfo()" class="bilan-btn-inline" id="bilanNovaBtn" style="white-space:nowrap; padding:8px 16px;">
                            🌐 Récupérer les infos
                        </button>
                    </div>
                    <div class="bilan-hint">Renseignez l'ID Nova pour pré-remplir automatiquement les informations campagne</div>
                    <div id="bilanNovaStatus" style="margin-top:6px;"></div>
                </div>

                <div class="bilan-form-group">
                    <label>ID(s) de campagne ADX</label>
                    <input type="text" id="bilanCampaignIds" class="bilan-input" value="${bilanData.campaignIds}" 
                        placeholder="Ex: 119145, 119148, 119151">
                    <div class="bilan-hint">Séparez les IDs par des virgules pour plusieurs campagnes. Pré-rempli depuis Nova si disponible.</div>
                </div>

                <div class="bilan-form-row">
                    <div class="bilan-form-group" style="flex:1">
                        <label>Date début</label>
                        <input type="date" id="bilanDateFrom" class="bilan-input" 
                            value="${bilanData.dateFrom || threeMonthsAgo}">
                    </div>
                    <div class="bilan-form-group" style="flex:1">
                        <label>Date fin</label>
                        <input type="date" id="bilanDateTo" class="bilan-input" 
                            value="${bilanData.dateTo || today}">
                    </div>
                </div>

                <div class="bilan-date-shortcuts">
                    <span class="bilan-date-shortcut" onclick="setBilanDateRange(7, 'days')">7 derniers jours</span>
                    <span class="bilan-date-shortcut" onclick="setBilanDateRange(30, 'days')">30 derniers jours</span>
                    <span class="bilan-date-shortcut" onclick="setBilanDateRange(3, 'months')">3 derniers mois</span>
                    <span class="bilan-date-shortcut" onclick="setBilanDateRange(6, 'months')">6 derniers mois</span>
                </div>

                <div class="bilan-form-group">
                    <label>Vues à générer par :</label>
                    <div class="bilan-views-checkboxes">
                        <label class="bilan-view-check"><input type="checkbox" value="global" ${bilanData.selectedViews.includes('global') ? 'checked' : ''} onchange="toggleApiView('global', this.checked)"> Date</label>
                        <label class="bilan-view-check"><input type="checkbox" value="formats" ${bilanData.selectedViews.includes('formats') ? 'checked' : ''} onchange="toggleApiView('formats', this.checked)"> Format</label>
                        <label class="bilan-view-check"><input type="checkbox" value="ciblages" ${bilanData.selectedViews.includes('ciblages') ? 'checked' : ''} onchange="toggleApiView('ciblages', this.checked)"> Ciblage</label>
                        <label class="bilan-view-check"><input type="checkbox" value="creatives" ${bilanData.selectedViews.includes('creatives') ? 'checked' : ''} onchange="toggleApiView('creatives', this.checked)"> Créative</label>
                        <label class="bilan-view-check"><input type="checkbox" value="codemonocle" ${bilanData.selectedViews.includes('codemonocle') ? 'checked' : ''} onchange="toggleApiView('codemonocle', this.checked)"> Code monocle</label>
                        <label class="bilan-view-check"><input type="checkbox" value="poi" ${bilanData.selectedViews.includes('poi') ? 'checked' : ''} onchange="toggleApiView('poi', this.checked)"> POI</label>
                        <label class="bilan-view-check"><input type="checkbox" value="device" ${bilanData.selectedViews.includes('device') ? 'checked' : ''} onchange="toggleApiView('device', this.checked)"> Device</label>
                        <label class="bilan-view-check"><input type="checkbox" value="os" ${bilanData.selectedViews.includes('os') ? 'checked' : ''} onchange="toggleApiView('os', this.checked)"> OS</label>
                        <label class="bilan-view-check"><input type="checkbox" value="capping" ${bilanData.selectedViews.includes('capping') ? 'checked' : ''} onchange="toggleApiView('capping', this.checked)"> Capping<br>Group</label>
                    </div>
                    <div class="bilan-form-group" style="margin-top:8px;">
                        <label class="bilan-view-check"><input type="checkbox" id="bilanMultiObjectifsCheck" ${bilanData.multiObjectifs ? 'checked' : ''} onchange="toggleMultiObjectifs(this.checked)"> 🎯 Multi objectifs <span style="font-size:11px;color:#888;">(si dates ou KPI différents entre subdivisions)</span></label>
                    </div>
                    <div id="bilanObjectiveSelector" class="bilan-form-group" style="margin-top:8px; display:${bilanData.multiObjectifs ? 'block' : 'none'};">
                        <label>Objectif :</label>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <select id="bilanSelectedObjective" class="bilan-input" onchange="bilanData.selectedObjective = this.value" style="flex:1;">
                                <option value="all">Tous les objectifs</option>
                            </select>
                            <button onclick="loadObjectivesFromApi()" class="bilan-btn-secondary" style="white-space:nowrap; padding:8px 12px;">
                                🔄 Charger objectifs
                            </button>
                        </div>
                    </div>
                    <div class="bilan-form-group" style="margin-top:8px;">
                        <label class="bilan-view-check"><input type="checkbox" ${bilanData.detailCiblage ? 'checked' : ''} onchange="bilanData.detailCiblage = this.checked"> 🔍 Détail ciblage <span style="font-size:11px;color:#888;">(Data Adsquare, Sirdata, Sémantique...)</span></label>
                    </div>
                </div>

                <div class="bilan-form-group">
                    <label>Métriques à récupérer</label>
                    <div class="bilan-stat-fields-search">
                        <input type="text" id="bilanStatFieldSearch" class="bilan-input" 
                            placeholder="Rechercher une métrique..." 
                            oninput="filterStatFields(this.value)">
                    </div>
                    <div id="bilanStatFieldsContainer" class="bilan-stat-fields-container">
                        <p style="color:#999; text-align:center; padding:20px;">Chargement des métriques...</p>
                    </div>
                </div>

                <button onclick="validateAndGoStep2()" class="bilan-btn-primary" id="bilanStep1Btn">
                    <span>🚀</span> Récupérer les statistiques
                </button>
            </div>
        </div>
    `;
    
    loadStatFieldsConfig();
}

/**
 * Récupère les infos campagne depuis l'API Nova et pré-remplit les champs
 */
async function fetchNovaInfo() {
    const novaIdInput = document.getElementById('bilanNovaId');
    const novaId = (novaIdInput ? novaIdInput.value : '').trim();
    if (!novaId) {
        showBilanNotification('Veuillez renseigner un ID Nova', 'warning');
        return;
    }
    bilanData.novaId = novaId;

    const btn = document.getElementById('bilanNovaBtn');
    const statusDiv = document.getElementById('bilanNovaStatus');
    if (btn) btn.disabled = true;
    if (btn) btn.innerHTML = '<span class="bilan-spinner"></span> Chargement...';
    if (statusDiv) statusDiv.innerHTML = '';

    try {
        const resp = await fetch('/api/bilan/fetch-nova', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ novaId })
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || `Erreur ${resp.status}`);
        }
        const data = await resp.json();
        bilanData.novaRawData = data.raw || null;

        // Pré-remplir ID ADX (seulement si le champ est vide)
        const adxInput = document.getElementById('bilanCampaignIds');
        if (adxInput && !adxInput.value.trim() && data.adxId) {
            adxInput.value = data.adxId;
            bilanData.campaignIds = data.adxId;
        }

        // Pré-remplir dates — toujours stocker dans bilanData
        if (data.dateFrom) {
            bilanData.dateFrom = data.dateFrom;
            console.log('📅 Nova dateFrom reçue:', data.dateFrom);
            const dfInput = document.getElementById('bilanDateFrom');
            if (dfInput) dfInput.value = data.dateFrom;
            // Aussi mettre à jour le champ du formulaire rapport auto si visible
            const srDateFrom = document.getElementById('sr_date_from');
            if (srDateFrom) {
                console.log('📅 Mise à jour sr_date_from:', data.dateFrom);
                srDateFrom.value = data.dateFrom;
            }
        }
        if (data.dateTo) {
            // Garder la vraie date de fin (même si dans le futur) pour le nom du fichier
            bilanData.dateTo = data.dateTo;
            const dtInput = document.getElementById('bilanDateTo');
            if (dtInput) dtInput.value = data.dateTo;
        }

        // Auto-cocher les métriques suggérées (catégories statiques uniquement)
        if (data.suggestedStatCategories && data.suggestedStatCategories.length > 0 && bilanData.apiStatFieldsConfig) {
            const fields = [];
            for (const catId of data.suggestedStatCategories) {
                const cat = bilanData.apiStatFieldsConfig.categories.find(c => c.id === catId);
                if (cat) fields.push(...cat.fields.map(f => f.key));
            }
            if (fields.length > 0) {
                bilanData.selectedStatFields = [...new Set(fields)];
                renderStatFields();
            }
        }
        // Multi-objectifs si KPIs ou dates différents entre subdivisions
        bilanData.multiObjectifs = !!data.hasMultiObjectifs;
        const multiCheck = document.getElementById('bilanMultiObjectifsCheck');
        if (multiCheck) multiCheck.checked = bilanData.multiObjectifs;
        
        // Afficher/masquer le sélecteur d'objectifs
        if (bilanData.multiObjectifs) {
            toggleMultiObjectifs(true);
        }

        // Stocker les données pour step 3 (seront injectées au rendu de step 3)
        if (data.subdivisionText) bilanData.subdivisions = data.subdivisionText;
        if (data.topDiffPerf) bilanData.topDiffPerf = data.topDiffPerf;
        if (data.dateDisplay) bilanData.date = data.dateDisplay;

        // Afficher le résumé
        const subCount = data.subdivisionCount || 0;
        const methods = (data.purchasingMethods || []).join(', ');
        if (statusDiv) {
            statusDiv.innerHTML = `
                <div style="background:#f0fdf4; border:1px solid #86efac; border-radius:8px; padding:10px 14px; font-size:0.85em;">
                    <div style="font-weight:600; color:#166534; margin-bottom:4px;">✅ Infos Nova récupérées</div>
                    <div><strong>Campagne:</strong> ${data.campaignName || '?'}</div>
                    <div><strong>ID ADX:</strong> ${data.adxId || '—'}</div>
                    <div><strong>Dates:</strong> ${data.dateDisplay || '—'}</div>
                    <div><strong>Mode d'achat:</strong> ${methods || '—'} | <strong>Budget:</strong> ${data.budget || '—'}</div>
                    <div><strong>Subdivisions:</strong> ${subCount} | <strong>Annonceur:</strong> ${data.advertiser || '—'} | <strong>Agence:</strong> ${data.agency || '—'}</div>
                </div>
            `;
        }
        showBilanNotification(`Nova: ${data.campaignName || 'Campagne'} — ${subCount} subdivision(s) récupérée(s)`, 'success');
    } catch (error) {
        if (statusDiv) {
            statusDiv.innerHTML = `<div style="color:#dc2626; font-size:0.85em;">❌ ${error.message}</div>`;
        }
        showBilanNotification('Erreur Nova: ' + error.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '🌐 Récupérer les infos'; }
    }
}

/**
 * Bascule entre mode fichier et mode API
 */
function switchSourceMode(mode) {
    bilanData.sourceMode = mode;
    document.getElementById('bilanSourceFile').style.display = mode === 'file' ? 'block' : 'none';
    document.getElementById('bilanSourceApi').style.display = mode === 'api' ? 'block' : 'none';
    document.querySelectorAll('.bilan-source-tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    const btn = document.getElementById('bilanStep1Btn');
    if (btn) btn.innerHTML = mode === 'api' ? '<span>🚀</span> Récupérer les statistiques' : '<span>🚀</span> Charger les statistiques';
    if (mode === 'api') loadStatFieldsConfig();
}

/**
 * Toggle une vue API (global/formats/ciblages/creatives)
 */
function toggleApiView(view, checked) {
    if (checked && !bilanData.selectedViews.includes(view)) {
        bilanData.selectedViews.push(view);
    } else if (!checked) {
        bilanData.selectedViews = bilanData.selectedViews.filter(v => v !== view);
    }
}

/**
 * Toggle multi-objectifs et affiche/masque le sélecteur d'objectif
 */
function toggleMultiObjectifs(checked) {
    bilanData.multiObjectifs = checked;
    const selector = document.getElementById('bilanObjectiveSelector');
    if (selector) {
        selector.style.display = checked ? 'block' : 'none';
    }
    // Réinitialiser la sélection à "all" quand on décoche
    if (!checked) {
        bilanData.selectedObjective = 'all';
        const select = document.getElementById('bilanSelectedObjective');
        if (select) select.value = 'all';
    }
}

/**
 * Peuple le sélecteur d'objectifs avec les noms détectés
 */
function populateObjectiveSelector(objectiveNames) {
    const select = document.getElementById('bilanSelectedObjective');
    if (!select) return;
    
    // Option par défaut "Tous les objectifs"
    select.innerHTML = '<option value="all">Tous les objectifs</option>';
    
    // Ajouter chaque objectif détecté
    for (const name of objectiveNames) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
    }
    
    // Restaurer la sélection actuelle si elle existe et différente de 'all'
    if (bilanData.selectedObjective && bilanData.selectedObjective !== 'all') {
        select.value = bilanData.selectedObjective;
    }
}

/**
 * Charge les objectifs depuis l'API ADX avec breakdown objectiveId et objectiveName
 */
async function loadObjectivesFromApi() {
    if (!bilanData.campaignIds) {
        showBilanNotification('Veuillez d\'abord saisir les IDs de campagne', 'warning');
        return;
    }

    const btn = event.target;
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="bilan-spinner"></span> Chargement...';

    try {
        const campaignIds = bilanData.campaignIds.split(',').map(id => id.trim()).filter(id => id);
        
        const response = await fetch('/api/bilan/fetch-objectives', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ campaignIds })
        });

        if (!response.ok) {
            throw new Error(`Erreur ${response.status}`);
        }

        const data = await response.json();
        
        if (!data.objectives || data.objectives.length === 0) {
            showBilanNotification('Aucun objectif trouvé pour cette campagne', 'warning');
            return;
        }

        // Stocker le mapping objectiveName -> objectiveId
        bilanData.objectivesMapping = {};
        const select = document.getElementById('bilanSelectedObjective');
        if (!select) return;
        
        // Option par défaut "Tous les objectifs"
        select.innerHTML = '<option value="all">Tous les objectifs</option>';
        
        // Ajouter chaque objectif détecté
        for (const obj of data.objectives) {
            const option = document.createElement('option');
            option.value = obj.name;
            option.textContent = obj.name;
            select.appendChild(option);
            bilanData.objectivesMapping[obj.name] = obj.id;
        }
        
        // Restaurer la sélection actuelle si elle existe et différente de 'all'
        if (bilanData.selectedObjective && bilanData.selectedObjective !== 'all') {
            select.value = bilanData.selectedObjective;
        }

        showBilanNotification(`${data.objectives.length} objectif(s) chargé(s)`, 'success');
        console.log(`✅ ${data.objectives.length} objectif(s) chargé(s):`, data.objectives.map(o => o.name));

    } catch (error) {
        console.error('❌ Erreur chargement objectifs:', error);
        showBilanNotification('Erreur lors du chargement des objectifs', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

/**
 * Charge la config des champs statistiques depuis le JSON
 */
async function loadStatFieldsConfig() {
    if (bilanData.apiStatFieldsConfig) {
        renderStatFields();
        return;
    }
    try {
        const [resp, kpiResp] = await Promise.all([
            fetch('/templates/bilan/api_statistic_fields.json'),
            fetch('/templates/bilan/kpi_library.json')
        ]);
        bilanData.apiStatFieldsConfig = await resp.json();
        if (kpiResp.ok) {
            const kpiData = await kpiResp.json();
            bilanData._kpiLibrary = kpiData.kpis || [];
        }
        if (bilanData.selectedStatFields.length === 0) {
            bilanData.selectedStatFields = [...bilanData.apiStatFieldsConfig.defaultSelected];
        }
        renderStatFields();
    } catch (e) {
        document.getElementById('bilanStatFieldsContainer').innerHTML = '<p style="color:red;">Erreur chargement config</p>';
    }
}

/**
 * Affiche les champs statistiques groupés par catégorie avec checkboxes
 */
function renderStatFields(filter = '') {
    const container = document.getElementById('bilanStatFieldsContainer');
    if (!container || !bilanData.apiStatFieldsConfig) return;
    
    const config = bilanData.apiStatFieldsConfig;
    const filterLower = filter.toLowerCase();
    let html = '';
    
    for (const cat of config.categories) {
        const fields = cat.fields.filter(f => 
            !filterLower || f.key.toLowerCase().includes(filterLower) || f.label.toLowerCase().includes(filterLower)
        );
        if (fields.length === 0) continue;
        
        const allChecked = fields.every(f => bilanData.selectedStatFields.includes(f.key));
        
        html += `<div class="bilan-stat-category" data-cat="${cat.id}">
            <div class="bilan-stat-category-header" onclick="toggleStatCategory('${cat.id}')">
                <label class="bilan-stat-cat-check">
                    <input type="checkbox" ${allChecked ? 'checked' : ''} 
                        onclick="event.stopPropagation(); toggleAllInCategory('${cat.id}', this.checked)">
                </label>
                <span class="bilan-stat-cat-label">${cat.label}</span>
                <span class="bilan-stat-cat-count">${fields.filter(f => bilanData.selectedStatFields.includes(f.key)).length}/${fields.length}</span>
                <span class="bilan-stat-cat-arrow" id="arrow_${cat.id}">▸</span>
            </div>
            <div class="bilan-stat-category-fields" id="catFields_${cat.id}" style="display:none;">
                ${fields.map(f => {
                    const checked = bilanData.selectedStatFields.includes(f.key);
                    const highlight = f.highlight ? ' bilan-stat-highlight' : '';
                    const apiInfo = f.api ? ` <span class="bilan-stat-api">(${f.api})</span>` : '';
                    return `<label class="bilan-stat-field${highlight}">
                        <input type="checkbox" value="${f.key}" ${checked ? 'checked' : ''} 
                            onchange="toggleStatField('${f.key}', this.checked)">
                        <span>${f.label}${apiInfo}</span>
                    </label>`;
                }).join('')}
            </div>
        </div>`;
    }
    
    const selectedCount = bilanData.selectedStatFields.length;
    html = `<div class="bilan-stat-fields-summary">${selectedCount} métrique${selectedCount > 1 ? 's' : ''} sélectionnée${selectedCount > 1 ? 's' : ''}</div>` + html;
    
    container.innerHTML = html;
}

function filterStatFields(query) {
    renderStatFields(query);
    // Auto-expand categories when searching
    if (query.length > 0) {
        document.querySelectorAll('.bilan-stat-category-fields').forEach(el => el.style.display = 'block');
        document.querySelectorAll('.bilan-stat-cat-arrow').forEach(el => el.textContent = '▾');
    }
}

function toggleStatCategory(catId) {
    const el = document.getElementById('catFields_' + catId);
    const arrow = document.getElementById('arrow_' + catId);
    if (el) {
        const show = el.style.display === 'none';
        el.style.display = show ? 'block' : 'none';
        if (arrow) arrow.textContent = show ? '▾' : '▸';
    }
}

function toggleStatField(key, checked) {
    if (checked && !bilanData.selectedStatFields.includes(key)) {
        bilanData.selectedStatFields.push(key);
    } else if (!checked) {
        bilanData.selectedStatFields = bilanData.selectedStatFields.filter(k => k !== key);
    }
    // Update summary count
    const summary = document.querySelector('.bilan-stat-fields-summary');
    if (summary) {
        const n = bilanData.selectedStatFields.length;
        summary.textContent = `${n} métrique${n > 1 ? 's' : ''} sélectionnée${n > 1 ? 's' : ''}`;
    }
    // Update category count + checkbox
    updateCategoryCounts();
}

function updateCategoryCounts() {
    const config = bilanData.apiStatFieldsConfig;
    if (!config) return;
    for (const cat of config.categories) {
        const catEl = document.querySelector(`.bilan-stat-category[data-cat="${cat.id}"]`);
        if (!catEl) continue;
        const countEl = catEl.querySelector('.bilan-stat-cat-count');
        const catCheck = catEl.querySelector('.bilan-stat-cat-check input[type="checkbox"]');
        const selected = cat.fields.filter(f => bilanData.selectedStatFields.includes(f.key)).length;
        if (countEl) countEl.textContent = `${selected}/${cat.fields.length}`;
        if (catCheck) catCheck.checked = selected === cat.fields.length;
    }
}

function toggleAllInCategory(catId, checked) {
    const config = bilanData.apiStatFieldsConfig;
    if (!config) return;
    const cat = config.categories.find(c => c.id === catId);
    if (!cat) return;
    for (const f of cat.fields) {
        if (checked && !bilanData.selectedStatFields.includes(f.key)) {
            bilanData.selectedStatFields.push(f.key);
        } else if (!checked) {
            bilanData.selectedStatFields = bilanData.selectedStatFields.filter(k => k !== f.key);
        }
    }
    renderStatFields(document.getElementById('bilanStatFieldSearch')?.value || '');
}

// ============================================
// ÉTAPE 2 : AFFICHAGE DES STATS
// ============================================
function renderBilanStep2() {
    bilanData.step = 2;
    const container = document.getElementById('bilanContainer');
    if (!container) return;
    
    const files = bilanData.statsFiles;
    
    container.innerHTML = `
        <div class="bilan-container-wide">
            <div class="bilan-header-nav">
                <div>
                    <h2>📊 Statistiques Campagne</h2>
                    <p>${bilanData.title || 'Bilan'} — ${files.length} fichier${files.length > 1 ? 's' : ''} chargé${files.length > 1 ? 's' : ''}</p>
                </div>
                <button onclick="renderBilanStep1(true)" class="bilan-btn-back">← Retour</button>
            </div>

            ${renderStepper(2)}

            ${files.length > 1 ? `
                <div class="bilan-file-tabs" style="margin-top: 20px;">
                    ${files.map((f, i) => `
                        <button class="bilan-file-tab ${i === 0 ? 'active' : ''}" onclick="switchBilanFileTab(${i})">
                            📄 ${f.name}
                        </button>
                    `).join('')}
                </div>
            ` : ''}

            <div id="bilanFileContent" style="margin-top: 15px;"></div>

            <div style="text-align: center; margin-top: 25px;">
                <button onclick="renderBilanStep3()" class="bilan-btn-inline">
                    Choisir un template <span>→</span>
                </button>
            </div>
        </div>
    `;
    
    if (files.length > 0) {
        renderBilanFileContent(0);
    }
}

function switchBilanFileTab(index) {
    // Update active tab
    document.querySelectorAll('.bilan-file-tab').forEach((tab, i) => {
        tab.classList.toggle('active', i === index);
    });
    renderBilanFileContent(index);
}

function renderBilanFileContent(fileIndex) {
    const contentZone = document.getElementById('bilanFileContent');
    if (!contentZone) return;
    
    const file = bilanData.statsFiles[fileIndex];
    if (!file) return;
    
    const kpis = file.kpis || {};
    const headers = file.headers || [];
    const rows = file.rows || [];
    
    contentZone.innerHTML = `
        <div class="bilan-kpis">
            ${Object.entries(kpis).map(([key, value]) => `
                <div class="bilan-kpi-box">
                    <div class="bilan-kpi-label">${key}</div>
                    <div class="bilan-kpi-value">${formatBilanValue(key, value)}</div>
                </div>
            `).join('')}
        </div>
        
        <div class="bilan-table-container" style="margin-top: 15px;">
            <h3 style="color: #333; margin-bottom: 15px;">📄 ${file.name} ${file.sheetName ? '— ' + file.sheetName : ''} <span style="color: #6c757d; font-weight: 400; font-size: 0.8em;">(${rows.length} lignes)</span></h3>
            ${rows.length === 0 ? '<p style="color: #6c757d; text-align: center;">Aucune donnée.</p>' : `
                <table class="bilan-table">
                    <thead>
                        <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
                    </thead>
                    <tbody>
                        ${rows.map(row => `
                            <tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>
                        `).join('')}
                    </tbody>
                </table>
            `}
        </div>
    `;
}


/**
 * Charge la liste des templates depuis le serveur (dossier templates/bilan/)
 */
async function loadServerTemplates() {
    const container = document.getElementById('bilanServerTemplates');
    if (!container) return;
    
    try {
        const response = await fetch('/api/bilan/templates', { credentials: 'include' });
        
        if (!response.ok) {
            container.innerHTML = '<p style="color: #6c757d;">Impossible de charger les templates.</p>';
            return;
        }
        
        const data = await response.json();
        const folders = data.folders || [];
        const allFiles = data.allFiles || [];
        const matchingConfig = data.matchingRules || null;
        
        if (folders.length === 0) {
            container.innerHTML = `
                <p style="color: #6c757d; text-align: center;">
                    Aucun template trouvé.<br>
                    <span style="font-size: 0.85em;">Déposez vos fichiers Excel dans le dossier <code>templates/bilan/</code> sur le serveur.</span>
                </p>
            `;
            return;
        }
        
        // Stocker l'état pour le filtrage
        _tplFilterState.allFiles = allFiles;
        _tplFilterState.matchingConfig = matchingConfig;
        
        // Extraire les tags auto-détectés
        _tplFilterState.tags = extractAutoTags(matchingConfig);
        
        // Helper : rendre un fichier template cliquable
        function renderFileRow(f) {
            const safePath = f.path.replace(/'/g, "\\'");
            const safeName = f.name.replace(/'/g, "\\'");
            const displayName = f.name.replace(/\.(xlsx|xls)$/i, '');
            return `
            <div class="bilan-tpl-file-row" data-tpl-path="${safePath}">
                <div class="bilan-tpl-file-select" onclick="selectServerTemplate('${safePath}', '${safeName}')" title="${f.name}">
                    <span class="bilan-tpl-file-icon">📊</span>
                    <span class="bilan-tpl-file-name">${displayName}</span>
                </div>
                <a class="bilan-tpl-file-download" href="/api/bilan/templates/download/${encodeURIComponent(f.path)}" download="${f.name}" title="Télécharger le masque" onclick="event.stopPropagation();">
                    ⬇
                </a>
            </div>`;
        }
        
        // Rendre tous les templates (accordion par dossier)
        let _tplIdx = 0;
        function renderFolderNode(node, depth) {
            const idx = _tplIdx++;
            const totalFiles = countFiles(node);
            const filesHtml = node.files.map(f => renderFileRow(f)).join('');
            const childrenHtml = (node.children || []).map(c => renderFolderNode(c, depth + 1)).join('');
            return `
            <div class="bilan-tpl-accordion${depth > 0 ? ' bilan-tpl-sub' : ''}">
                <div class="bilan-tpl-accordion-header" onclick="toggleTplFolder(${idx})">
                    <span class="bilan-tpl-accordion-icon" id="tplFolderIcon${idx}">▶</span>
                    <span class="bilan-tpl-accordion-title">📁 ${node.name}</span>
                    <span class="bilan-tpl-accordion-badge">${totalFiles}</span>
                </div>
                <div class="bilan-tpl-accordion-body" id="tplFolder${idx}" style="display:none;">
                    ${filesHtml}${childrenHtml}
                </div>
            </div>`;
        }
        function countFiles(node) {
            let n = node.files.length;
            for (const c of (node.children || [])) n += countFiles(c);
            return n;
        }
        container.innerHTML = folders.map(f => renderFolderNode(f, 0)).join('');
        
        // Afficher les tags et appliquer les filtres
        renderTplFilterTags();
        applyTplFilters();
        
        // Restaurer le highlight si un template était déjà sélectionné
        if (bilanData.selectedTemplatePath) {
            const safePath = bilanData.selectedTemplatePath.replace(/"/g, '\\"');
            const activeRow = document.querySelector(`.bilan-tpl-file-row[data-tpl-path="${safePath}"]`);
            if (activeRow) {
                activeRow.classList.add('bilan-tpl-selected');
                // Ouvrir les accordions parents pour rendre visible
                let parent = activeRow.parentElement;
                while (parent && parent.id !== 'bilanServerTemplates') {
                    if (parent.classList.contains('bilan-tpl-accordion-body')) {
                        parent.style.display = 'block';
                        const icon = parent.previousElementSibling?.querySelector('.bilan-tpl-accordion-icon');
                        if (icon) icon.textContent = '▼';
                    }
                    parent = parent.parentElement;
                }
            }
        }
        
    } catch (error) {
        console.error('Erreur chargement templates:', error);
        container.innerHTML = '<p style="color: #6c757d;">Erreur de chargement.</p>';
    }
}

/**
 * Toggle accordion folder open/close
 */
function toggleTplFolder(idx) {
    const body = document.getElementById(`tplFolder${idx}`);
    const icon = document.getElementById(`tplFolderIcon${idx}`);
    if (!body) return;
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    if (icon) icon.textContent = isOpen ? '▶' : '▼';
}


/**
 * Sélectionne un template depuis le serveur, le télécharge et le parse
 */
async function selectServerTemplate(filePath, fileName) {
    showBilanNotification(`Chargement de "${fileName}"...`, 'info');
    
    try {
        const response = await fetch(`/api/bilan/templates/download/${encodeURIComponent(filePath)}`, {
            credentials: 'include'
        });
        
        if (!response.ok) throw new Error('Template non trouvé');
        
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', raw: false });
        
        bilanData.selectedTemplate = 'server';
        bilanData.selectedTemplatePath = filePath;
        bilanData.customTemplateFile = { name: fileName };
        bilanData.templateData = {};
        for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            bilanData.templateData[sheetName] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        }
        
        showBilanNotification(`Template "${fileName}" sélectionné (${workbook.SheetNames.length} feuille${workbook.SheetNames.length > 1 ? 's' : ''}).`, 'success');
        
        // Mettre à jour le highlight visuel sans re-rendre toute la page
        document.querySelectorAll('.bilan-tpl-file-row').forEach(row => row.classList.remove('bilan-tpl-selected'));
        const activeRow = document.querySelector(`.bilan-tpl-file-row[data-tpl-path="${filePath.replace(/"/g, '\\"')}"]`);
        if (activeRow) activeRow.classList.add('bilan-tpl-selected');
        
        // Afficher le bouton Continuer s'il n'existe pas encore
        if (!document.getElementById('bilanContinueBtn')) {
            const container = document.querySelector('.bilan-container');
            if (container) {
                const btnDiv = document.createElement('div');
                btnDiv.id = 'bilanContinueBtn';
                btnDiv.style.cssText = 'text-align:center;margin-top:20px;';
                btnDiv.innerHTML = '<button onclick="renderBilanStep4()" class="bilan-btn-inline">Continuer <span>→</span></button>';
                container.appendChild(btnDiv);
            }
        }
        
    } catch (error) {
        showBilanNotification('Erreur : ' + error.message, 'error');
    }
}

// ============================================
// ÉTAPE 4 : SÉLECTION TEMPLATE
// ============================================

// État global des filtres templates
let _tplFilterState = { tags: [], allFiles: [], matchingConfig: null, searchText: '' };

// ============================================
// ÉTAPE 3 : TEMPLATE
// ============================================
function renderBilanStep3() {
    bilanData.step = 3;
    const container = document.getElementById('bilanContainer');
    if (!container) return;
    
    const hasTemplate = bilanData.customTemplateFile;
    const selectedName = hasTemplate ? (bilanData.customTemplateFile.name || bilanData.customTemplateFile) : null;
    
    container.innerHTML = `
        <div class="bilan-container">
            <div class="bilan-header-nav">
                <div>
                    <h2>📄 Choisir un template</h2>
                    <p>Sélectionnez un template existant ou importez le vôtre.</p>
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                    ${bilanData._apiRawHeaders ? `
                    <div style="position:relative; display:inline-block;">
                        <button onclick="toggleExportMenu()" class="bilan-btn-back" id="bilanExportMenuBtn" style="display:flex; align-items:center; gap:4px;">
                            📥 Exports <span style="font-size:0.7em;">▼</span>
                        </button>
                        <div id="bilanExportMenu" style="display:none; position:absolute; right:0; top:100%; margin-top:4px; background:#fff; border:1px solid #e2e8f0; border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,0.12); min-width:240px; z-index:100; overflow:hidden;">
                            <div onclick="exportApiStatsExcel(); toggleExportMenu();" style="padding:10px 16px; cursor:pointer; font-size:0.88em; display:flex; align-items:center; gap:8px; border-bottom:1px solid #f1f5f9;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='#fff'">
                                📊 Statistiques (.xlsx)
                            </div>
                            <div onclick="exportApiStatsJson(); toggleExportMenu();" style="padding:10px 16px; cursor:pointer; font-size:0.88em; display:flex; align-items:center; gap:8px; border-bottom:1px solid #f1f5f9;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='#fff'">
                                📋 Statistiques (.json)
                            </div>
                            ${bilanData._aggBase64 ? `<div onclick="downloadAggregatedFile(); toggleExportMenu();" style="padding:10px 16px; cursor:pointer; font-size:0.88em; display:flex; align-items:center; gap:8px; border-bottom:1px solid #f1f5f9;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='#fff'">
                                📈 Agrégé (.xlsx)
                            </div>` : ''}
                            ${bilanData._apiViews?.reach?.rows?.length ? `<div onclick="exportReachData(); toggleExportMenu();" style="padding:10px 16px; cursor:pointer; font-size:0.88em; display:flex; align-items:center; gap:8px; border-bottom:1px solid #f1f5f9;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='#fff'">
                                👥 Reach (.xlsx)
                            </div>` : ''}
                            ${bilanData.topDiffPerf ? `<div onclick="exportTopDiffPerf(); toggleExportMenu();" style="padding:10px 16px; cursor:pointer; font-size:0.88em; display:flex; align-items:center; gap:8px; border-bottom:1px solid #f1f5f9;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='#fff'">
                                🏆 Top Diff / Perf (.xlsx)
                            </div>` : ''}
                            ${bilanData.subdivisions ? `<div onclick="exportSubdivisions(); toggleExportMenu();" style="padding:10px 16px; cursor:pointer; font-size:0.88em; display:flex; align-items:center; gap:8px; border-bottom:1px solid #f1f5f9;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='#fff'">
                                📑 Subdivisions (.txt)
                            </div>` : ''}
                            <div onclick="exportAllZip(); toggleExportMenu();" style="padding:10px 16px; cursor:pointer; font-size:0.88em; display:flex; align-items:center; gap:8px; background:#f0fdf4; font-weight:600; color:#166534;" onmouseover="this.style.background='#dcfce7'" onmouseout="this.style.background='#f0fdf4'">
                                📦 Tout exporter (.zip)
                            </div>
                        </div>
                    </div>
                    ` : ''}
                    <button onclick="renderBilanStep1(true)" class="bilan-btn-back">← Retour</button>
                </div>
            </div>

            ${renderStepper(3)}

            <!-- Filtres actifs (tags) + recherche -->
            <div class="bilan-card" style="margin-top:0;">
                <div id="bilanTplFilters" style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:10px;"></div>
                <input type="text" id="bilanTplSearch" class="bilan-input" placeholder="🔍 Rechercher ou ajouter un filtre..." oninput="onTplSearchInput(this.value)" onkeydown="onTplSearchKey(event)" style="padding:10px 14px; font-size:0.9em;">
            </div>

            <!-- Liste des templates (filtrée) -->
            <div class="bilan-card" style="margin-top: 10px;">
                <div id="bilanServerTemplates">
                    <p style="color: #6c757d; text-align: center;"><span class="bilan-spinner"></span> Chargement des templates...</p>
                </div>
            </div>

            <!-- Upload custom -->
            <div class="bilan-card" style="margin-top: 15px;">
                <h3>📂 Ou importez votre propre template</h3>
                <div class="bilan-upload-zone" id="bilanTemplateDropZone"
                    ondragover="event.preventDefault(); this.classList.add('dragover')"
                    ondragleave="this.classList.remove('dragover')"
                    ondrop="handleTemplateDrop(event)"
                    onclick="document.getElementById('bilanTemplateInput').click()">
                    <div class="icon">${hasTemplate ? '✅' : '📄'}</div>
                    <p class="label" id="bilanTemplateFileName">${selectedName || 'Déposez votre template Excel ici'}</p>
                    <p class="hint">Formats acceptés : XLSX, XLS</p>
                </div>
                <input type="file" id="bilanTemplateInput" accept=".xlsx,.xls" style="display: none;" onchange="handleTemplateUpload(this.files[0])">
            </div>

            ${hasTemplate ? `
                <div style="text-align: center; margin-top: 20px;">
                    <button onclick="renderBilanStep4()" class="bilan-btn-inline">
                        Continuer <span>→</span>
                    </button>
                </div>
            ` : ''}
        </div>
    `;
    
    // Charger les templates depuis le serveur
    loadServerTemplates();
}

/**
 * Extraire les tags auto-détectés depuis campagne + subdivision
 */
function extractAutoTags(matchingConfig) {
    const tags = [];
    const campaignName = (bilanData.apiCampaignName || bilanData.title || '').toUpperCase();
    const subdivText = (bilanData.subdivisions || '').toUpperCase();
    console.log('[extractAutoTags] campaignName=', JSON.stringify(campaignName), 'subdivText length=', subdivText.length);
    
    // Détecter ABR, NRJ ou Carrefour (clients spécifiques)
    // Si client spécifique détecté, ne garder QUE ce filtre (ignorer CPM/CPC/KPI)
    let hasClientTag = false;
    
    if (/ABR/i.test(campaignName)) {
        hasClientTag = true;
        // Détecter si c'est Gaël ou Renaud
        if (/GA[EËÉÈÊ][LŁ]|GAEL|GA[ÉE]L|GAËL|\bG\b/i.test(campaignName)) {
            console.log('[extractAutoTags] ✅ ABR — Gaël (filtre exclusif)');
            tags.push({ id: 'client_abr_gael', label: 'ABR — Gaël', type: 'client', folders: ['ABR/Gaël'], auto: true });
        } else if (/RENAUD|RÉNO|RENO/i.test(campaignName)) {
            console.log('[extractAutoTags] ✅ ABR — Renaud (filtre exclusif)');
            tags.push({ id: 'client_abr_renaud', label: 'ABR — Renaud', type: 'client', folders: ['ABR/Renaud'], auto: true });
        } else {
            // Par défaut : Renaud
            console.log('[extractAutoTags] ✅ ABR — Renaud par défaut (filtre exclusif)');
            tags.push({ id: 'client_abr_renaud', label: 'ABR — Renaud', type: 'client', folders: ['ABR/Renaud'], auto: true });
        }
    } else if (/\bNRJ\b|NRJ[_\-\s]?(MUSIC|RADIO|TV|PLAY|HIT)?|NRJ\d*/i.test(campaignName)) {
        hasClientTag = true;
        console.log('[extractAutoTags] ✅ NRJ (filtre exclusif)');
        tags.push({ id: 'client_nrj', label: 'NRJ', type: 'client', folders: ['NRJ'], auto: true });
    } else if (/CARREFOUR|CARRE[- ]?FOUR|CRF\b/i.test(campaignName)) {
        hasClientTag = true;
        console.log('[extractAutoTags] ✅ Carrefour (filtre exclusif)');
        tags.push({ id: 'client_carrefour', label: 'Carrefour', type: 'client', folders: ['Carrefour'], auto: true });
    }
    
    // Si un client spécifique (ABR/NRJ) est détecté, ne pas ajouter d'autres filtres
    if (hasClientTag) {
        console.log('[extractAutoTags] Client spécifique détecté - ignore CPM/CPC/KPI');
        console.log('[extractAutoTags] Tags générés:', tags.map(t => t.label).join(', '));
        return tags;
    }
    
    // Sinon, extraire mode d'achat depuis subdivisions
    const buyMatch = subdivText.match(/MODE\s*D[''\u2019]?\s*ACHAT\s*[:=]?\s*(CPM|CPC)/i);
    if (buyMatch) {
        const mode = buyMatch[1].toUpperCase();
        tags.push({ id: 'buying_' + mode, label: mode, type: 'buying', keyword: mode, auto: true });
    }
    
    // Détecter KPI limités (visibilité, attention, VCR, LP) - max 1 KPI
    // Chercher dans subdivisions et métriques sélectionnées
    const kpiMatch = subdivText.match(/KPI\s*PRINCIPAL\s*[:=]?\s*([^\n]+)/i);
    const kpiText = kpiMatch ? kpiMatch[1].trim().toUpperCase() : '';
    const selectedFields = bilanData.selectedStatFields || [];
    
    let detectedKpi = null;
    
    // Visibilité
    if (/VISIBILIT/i.test(kpiText) || selectedFields.some(f => ['evMraid1', 'evMraid2', 'evMraid3', 'evMraid4', 'evMraid5', 'evMraid6', 'enovTauxVisibilite'].includes(f))) {
        detectedKpi = { id: 'visibilite', label: 'Visibilité', keywords: ['VISIBILITE', 'VISIBILITÉ', 'VIEWABILITY', 'INVIEW', 'IN VIEW', 'VISIBLE'] };
    }
    // Attention
    else if (/ATTENTION/i.test(kpiText) || selectedFields.some(f => ['enovAttm1', 'enovAttm2'].includes(f))) {
        detectedKpi = { id: 'attention', label: 'Attention', keywords: ['ATTENTION', 'ATTN', 'ATTENTIVE REACH', 'TEMPS ATTENTION', 'TAUX ATTENTION'] };
    }
    // VCR / Complétion vidéo
    else if (/VCR|COMPL|VIDEO/i.test(kpiText)) {
        detectedKpi = { id: 'vcr', label: 'VCR', keywords: ['VCR', 'COMPLETION', 'COMPLÉTION', 'VIDEO COMPLETION', 'VUES COMPLÈTES', '100%'] };
    }
    // LP / Visites LP
    else if (/VISITE\s*LP|LP|LANDING/i.test(kpiText)) {
        detectedKpi = { id: 'lp', label: 'LP', keywords: ['LP', 'LANDING PAGE', 'VISITE LP', 'VISITES LP', 'TAUX VISITE'] };
    }
    
    if (detectedKpi) {
        tags.push({ id: 'kpi_' + detectedKpi.id, label: detectedKpi.label, type: 'kpi', keywords: detectedKpi.keywords, auto: true });
    }
    
    console.log('[extractAutoTags] Tags générés:', tags.map(t => t.label).join(', '));
    return tags;
}

/**
 * Rendre les tags filtres dans la barre
 */
function renderTplFilterTags() {
    const container = document.getElementById('bilanTplFilters');
    if (!container) return;
    
    const typeColors = { client: '#7c3aed', buying: '#2563eb', kpi: '#059669', multi: '#d97706', search: '#6b7280' };
    
    container.innerHTML = _tplFilterState.tags.map(tag => {
        const color = typeColors[tag.type] || '#6b7280';
        return `<span class="bilan-tpl-tag" style="background:${color}15; color:${color}; border:1px solid ${color}40;">
            ${tag.label}
            <span class="bilan-tpl-tag-remove" onclick="removeTplTag('${tag.id}')" title="Retirer ce filtre">×</span>
        </span>`;
    }).join('');
    
    if (_tplFilterState.tags.length === 0) {
        container.innerHTML = '<span style="color:#9ca3af; font-size:0.85em;">Aucun filtre actif — tous les templates sont affichés</span>';
    }
}

/**
 * Retirer un tag filtre et re-filtrer
 */
function removeTplTag(tagId) {
    _tplFilterState.tags = _tplFilterState.tags.filter(t => t.id !== tagId);
    renderTplFilterTags();
    applyTplFilters();
}

/**
 * Ajouter un tag recherche libre
 */
function addTplSearchTag(text) {
    if (!text.trim()) return;
    const id = 'search_' + text.trim().toLowerCase().replace(/\s+/g, '_');
    if (_tplFilterState.tags.some(t => t.id === id)) return;
    _tplFilterState.tags.push({ id, label: text.trim(), type: 'search', keyword: text.trim(), auto: false });
    renderTplFilterTags();
    applyTplFilters();
    const input = document.getElementById('bilanTplSearch');
    if (input) input.value = '';
    _tplFilterState.searchText = '';
}

/**
 * Input handler pour la recherche en temps réel
 */
function onTplSearchInput(value) {
    _tplFilterState.searchText = value.trim();
    applyTplFilters();
}

/**
 * Entrée = ajouter un tag
 */
function onTplSearchKey(event) {
    if (event.key === 'Enter' && _tplFilterState.searchText) {
        event.preventDefault();
        addTplSearchTag(_tplFilterState.searchText);
    }
}

/**
 * Normalise un texte : supprime les accents, met en majuscules, normalise les séparateurs
 */
function normTpl(str) {
    return (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[_\-\s]+/g, ' ');
}

/**
 * Appliquer tous les filtres actifs sur la liste de templates
 * Chaque tag doit matcher (AND) : le fichier doit satisfaire TOUS les tags
 */
function applyTplFilters() {
    const allFiles = _tplFilterState.allFiles;
    let tags = _tplFilterState.tags;
    const searchText = normTpl(_tplFilterState.searchText);
    
    const rows = document.querySelectorAll('#bilanServerTemplates .bilan-tpl-file-row');
    
    // Helper: compter les résultats visibles avec un set de tags donné
    function countVisible(useTags) {
        let count = 0;
        rows.forEach(row => {
            const rawPath = row.getAttribute('data-tpl-path') || '';
            const rawName = row.querySelector('.bilan-tpl-file-name')?.textContent || '';
            const path = normTpl(rawPath);
            const name = normTpl(rawName);
            const fullText = path + ' ' + name;
            let visible = true;
            for (const tag of useTags) {
                let tagMatch = false;
                if (tag.type === 'client' && tag.folders) {
                    tagMatch = tag.folders.some(f => path.startsWith(normTpl(f)));
                } else if (tag.type === 'buying' && tag.keyword) {
                    tagMatch = fullText.includes(normTpl(tag.keyword));
                } else if (tag.type === 'kpi' && tag.keywords) {
                    tagMatch = tag.keywords.some(kw => fullText.includes(normTpl(kw)));
                } else if (tag.type === 'multi' && tag.fileMatch) {
                    try { tagMatch = new RegExp(tag.fileMatch, 'i').test(rawName); } catch(e) { tagMatch = false; }
                } else if (tag.type === 'exclude_multi' && tag.fileMatch) {
                    // Inverse : le fichier matche si NI le nom NI le chemin ne correspondent au regex multi
                    try { const re = new RegExp(tag.fileMatch, 'i'); tagMatch = !re.test(rawName) && !re.test(rawPath); } catch(e) { tagMatch = true; }
                } else if (tag.type === 'search' && tag.keyword) {
                    tagMatch = fullText.includes(normTpl(tag.keyword));
                }
                if (!tagMatch) { visible = false; break; }
            }
            if (visible && searchText && !fullText.includes(searchText)) visible = false;
            if (visible) count++;
        });
        return count;
    }
    
    // Fallback progressif : si 0 résultats avec tous les tags auto, retirer un par un
    // Ordre de retrait (moins important d'abord) : multi → kpi → buying (client jamais retiré)
    const removePriority = ['exclude_multi', 'multi', 'kpi', 'buying'];
    let removedTags = [];
    if (tags.length > 0 && countVisible(tags) === 0) {
        let activeTags = [...tags];
        for (const typeToRemove of removePriority) {
            const autoOfType = activeTags.filter(t => t.auto && t.type === typeToRemove);
            if (autoOfType.length === 0) continue;
            // Retirer les tags de ce type un par un (dernier ajouté d'abord)
            for (let i = autoOfType.length - 1; i >= 0; i--) {
                const candidate = activeTags.filter(t => !(t.auto && t.type === typeToRemove && t.id === autoOfType[i].id));
                if (countVisible(candidate) > 0) {
                    removedTags.push(autoOfType[i]);
                    activeTags = candidate;
                    break;
                }
            }
            if (countVisible(activeTags) > 0) break;
            // Retirer tous les tags de ce type
            const removed = activeTags.filter(t => t.auto && t.type === typeToRemove);
            activeTags = activeTags.filter(t => !(t.auto && t.type === typeToRemove));
            removedTags.push(...removed);
            if (countVisible(activeTags) > 0) break;
        }
        if (countVisible(activeTags) > 0) {
            // Mettre à jour les tags actifs (désactiver les retirés dans l'UI)
            _tplFilterState.tags = activeTags;
            tags = activeTags;
        }
    }
    
    let visibleCount = 0;
    rows.forEach(row => {
        const rawPath = row.getAttribute('data-tpl-path') || '';
        const rawName = row.querySelector('.bilan-tpl-file-name')?.textContent || '';
        const path = normTpl(rawPath);
        const name = normTpl(rawName);
        const fullText = path + ' ' + name;
        
        let visible = true;
        
        // Chaque tag doit matcher
        for (const tag of tags) {
            let tagMatch = false;
            
            if (tag.type === 'client' && tag.folders) {
                tagMatch = tag.folders.some(f => path.startsWith(normTpl(f)));
            } else if (tag.type === 'buying' && tag.keyword) {
                tagMatch = fullText.includes(normTpl(tag.keyword));
            } else if (tag.type === 'kpi' && tag.keywords) {
                tagMatch = tag.keywords.some(kw => fullText.includes(normTpl(kw)));
            } else if (tag.type === 'multi' && tag.fileMatch) {
                try { tagMatch = new RegExp(tag.fileMatch, 'i').test(rawName); } catch(e) { tagMatch = false; }
            } else if (tag.type === 'exclude_multi' && tag.fileMatch) {
                // Inverse : le fichier matche si NI le nom NI le chemin ne correspondent au regex multi
                try { const re = new RegExp(tag.fileMatch, 'i'); tagMatch = !re.test(rawName) && !re.test(rawPath); } catch(e) { tagMatch = true; }
            } else if (tag.type === 'search' && tag.keyword) {
                tagMatch = fullText.includes(normTpl(tag.keyword));
            }
            
            if (!tagMatch) { visible = false; break; }
        }
        
        // Filtre recherche live (en plus des tags)
        if (visible && searchText && !fullText.includes(searchText)) {
            visible = false;
        }
        
        row.style.display = visible ? '' : 'none';
        if (visible) visibleCount++;
    });
    
    // Ouvrir/fermer les accordions en fonction de la visibilité
    document.querySelectorAll('#bilanServerTemplates .bilan-tpl-accordion').forEach(acc => {
        const body = acc.querySelector('.bilan-tpl-accordion-body');
        const icon = acc.querySelector('.bilan-tpl-accordion-icon');
        const visibleRows = body ? body.querySelectorAll('.bilan-tpl-file-row:not([style*="display: none"])') : [];
        const hasVisible = visibleRows.length > 0;
        acc.style.display = hasVisible ? '' : 'none';
        if (hasVisible && (tags.length > 0 || searchText)) {
            body.style.display = 'block';
            if (icon) icon.textContent = '▼';
        }
    });
    
    // Compteur + message fallback
    const countEl = document.getElementById('bilanTplCount');
    if (countEl) {
        let msg = `${visibleCount} template${visibleCount > 1 ? 's' : ''}`;
        if (removedTags.length > 0) {
            msg += ` (filtres relâchés : ${removedTags.map(t => t.label).join(', ')})`;
        }
        countEl.textContent = msg;
    }
    
    // Mettre à jour les chips des tags retirés (les barrer visuellement)
    if (removedTags.length > 0) {
        document.querySelectorAll('#bilanTplTags .bilan-tpl-tag').forEach(chip => {
            const tagId = chip.getAttribute('data-tag-id');
            if (removedTags.some(t => t.id === tagId)) {
                chip.style.opacity = '0.4';
                chip.style.textDecoration = 'line-through';
            }
        });
    }
}

// ============================================
// ÉTAPE 4 : ANALYSE (optionnelle)
// ============================================
function renderBilanStep4() {
    bilanData.step = 4;
    const container = document.getElementById('bilanContainer');
    if (!container) return;
    
    container.innerHTML = `
        <div class="bilan-container">
            <div class="bilan-header-nav">
                <div>
                    <h2>📊 Analyse de la campagne</h2>
                    <p>Souhaitez-vous une analyse rédigée par l'IA à partir de vos statistiques ?</p>
                </div>
                <button onclick="renderBilanStep3()" class="bilan-btn-back">← Retour au template</button>
            </div>

            ${renderStepper(4)}

            <div class="bilan-card">
                <h3>
                    <span class="bilan-step-number">4</span>
                    Analyse IA
                </h3>
                
                <div class="bilan-analysis-toggle">
                    <label class="bilan-toggle">
                        <input type="checkbox" id="bilanWantAnalysis" ${bilanData.wantAnalysis ? 'checked' : ''}
                            onchange="toggleAnalysisOptions(this.checked)">
                        <span class="bilan-toggle-slider"></span>
                    </label>
                    <span class="bilan-toggle-label">Oui, je veux une analyse rédigée</span>
                </div>
                
                <div id="bilanAnalysisOptions" style="display: ${bilanData.wantAnalysis ? 'block' : 'none'}; margin-top: 20px;">
                    <div class="bilan-form-group">
                        <label>Type de bilan</label>
                        <div class="bilan-form-row">
                            <label class="bilan-radio-card ${bilanData.analysisType === 'simple' ? 'selected' : ''}" onclick="selectAnalysisType('simple')">
                                <input type="radio" name="analysisType" value="simple" ${bilanData.analysisType === 'simple' ? 'checked' : ''}>
                                <div class="bilan-radio-content">
                                    <strong>📋 Bilan simple</strong>
                                    <p>Synthèse rapide et orientée "quoi retenir"</p>
                                </div>
                            </label>
                            <label class="bilan-radio-card ${bilanData.analysisType === 'pousse' ? 'selected' : ''}" onclick="selectAnalysisType('pousse')">
                                <input type="radio" name="analysisType" value="pousse" ${bilanData.analysisType === 'pousse' ? 'checked' : ''}>
                                <div class="bilan-radio-content">
                                    <strong>🔍 Bilan poussé</strong>
                                    <p>Analyse approfondie, insights stratégiques, recommandations détaillées</p>
                                </div>
                            </label>
                        </div>
                    </div>
                    
                    <div class="bilan-form-group">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <label>💬 Contexte / commentaires d'optimisation (optionnel)</label>
                            <span id="adxCommentsStatus" style="font-size:0.8em; color:#64748b;"></span>
                        </div>
                        ${(bilanData.campaignList && bilanData.campaignList.length > 1) ? 
                            bilanData.campaignList.map((c, i) => `
                                <div style="margin-bottom: 12px; padding: 12px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #0ea5e9;">
                                    <label style="font-size: 0.85em; font-weight: 600; color: #1e293b; margin-bottom: 6px; display: block;">
                                        📌 Campagne ${i + 1} : ${c.name} <span style="color: #94a3b8; font-weight: 400;">(ID ${c.id})</span>
                                    </label>
                                    <textarea id="bilanAnalysisContext_${c.id}" class="bilan-input" rows="3" 
                                        placeholder="Commentaires spécifiques à cette campagne...">${(bilanData.analysisContextPerCampaign && bilanData.analysisContextPerCampaign[c.id]) || ''}</textarea>
                                </div>
                            `).join('') 
                        : `<textarea id="bilanAnalysisContext" class="bilan-input" rows="4" 
                            placeholder="Ex: Le capping a été resserré en semaine 3, on a coupé les SSP sous-performants mi-campagne...">${bilanData.analysisContext || ''}</textarea>`}
                    </div>
                </div>
            </div>
            
            <div style="text-align: center; margin-top: 20px;">
                <button onclick="validateAndGoStep6()" class="bilan-btn-inline">
                    Générer le bilan <span>→</span>
                </button>
            </div>
        </div>
    `;

    // Chargement automatique des commentaires ADX
    loadAdxComments();
}

function toggleAnalysisOptions(checked) {
    bilanData.wantAnalysis = checked;
    const opts = document.getElementById('bilanAnalysisOptions');
    if (opts) opts.style.display = checked ? 'block' : 'none';
}

function selectAnalysisType(type) {
    bilanData.analysisType = type;
    document.querySelectorAll('.bilan-radio-card').forEach(c => c.classList.remove('selected'));
    const radio = document.querySelector(`input[name="analysisType"][value="${type}"]`);
    if (radio) {
        radio.checked = true;
        radio.closest('.bilan-radio-card')?.classList.add('selected');
    }
}

function validateAndGoStep6() {
    bilanData.wantAnalysis = document.getElementById('bilanWantAnalysis')?.checked || false;
    if (bilanData.wantAnalysis) {
        if (bilanData.campaignList && bilanData.campaignList.length > 1) {
            // Multi-campagnes : collecter les commentaires par campagne
            bilanData.analysisContextPerCampaign = {};
            const parts = [];
            for (const c of bilanData.campaignList) {
                const val = document.getElementById('bilanAnalysisContext_' + c.id)?.value.trim() || '';
                bilanData.analysisContextPerCampaign[c.id] = val;
                if (val) {
                    parts.push(`### Campagne "${c.name}" (ID ${c.id})\n${val}`);
                }
            }
            bilanData.analysisContext = parts.length > 0 ? parts.join('\n\n') : '';
        } else {
            bilanData.analysisContext = document.getElementById('bilanAnalysisContext')?.value.trim() || '';
        }
    }

    // Popup nettoyage commentaires (une seule fois, uniquement si analyse demandée)
    if (bilanData.wantAnalysis && bilanData._commentsLoaded && !bilanData._commentsCleanConfirmed) {
        showCommentsCleanPopup();
        return;
    }
    generateBilan();
}

function showCommentsCleanPopup() {
    // Créer l'overlay
    const overlay = document.createElement('div');
    overlay.id = 'commentsCleanOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;';
    overlay.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:28px 32px;max-width:440px;width:90%;box-shadow:0 8px 30px rgba(0,0,0,0.2);text-align:center;">
            <div style="font-size:2em;margin-bottom:12px;">🧹</div>
            <h3 style="margin:0 0 10px;font-size:1.1em;">Avez-vous nettoyé les commentaires avant analyse ?</h3>
            <p style="color:#666;font-size:0.9em;margin-bottom:20px;">Vérifiez que les commentaires ADX ne contiennent pas d'informations inutiles ou erronées.</p>
            <div style="display:flex;gap:10px;justify-content:center;">
                <button id="commentsCleanNo" style="padding:10px 24px;border:1px solid #d1d5db;border-radius:8px;background:#fff;cursor:pointer;font-size:0.95em;">Non, je modifie</button>
                <button id="commentsCleanYes" style="padding:10px 24px;border:none;border-radius:8px;background:#22c55e;color:#fff;cursor:pointer;font-size:0.95em;font-weight:600;">Oui, continuer</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('commentsCleanYes').onclick = () => {
        bilanData._commentsCleanConfirmed = true;
        overlay.remove();
        generateBilan();
    };
    document.getElementById('commentsCleanNo').onclick = () => {
        overlay.remove();
    };
}

/**
 * Charger les commentaires ADX et pré-remplir les textareas (auto-appelé à l'arrivée sur step 5)
 */
async function loadAdxComments() {
    const status = document.getElementById('adxCommentsStatus');
    
    const ids = (bilanData.campaignIds || '').split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
    if (ids.length === 0) {
        if (status) status.textContent = '';
        return;
    }
    
    if (status) status.innerHTML = '⏳ Chargement des commentaires ADX...';
    
    try {
        const response = await fetch('/api/bilan/fetch-comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ campaignIds: ids })
        });
        
        if (!response.ok) throw new Error('Erreur serveur ' + response.status);
        const data = await response.json();
        const comments = data.comments || {};
        
        // Formater les commentaires : "📅 date — message"
        function formatComments(list) {
            if (!list || list.length === 0) return '';
            return list.map(c => {
                const d = c.date ? c.date.split(' ')[0] : '';
                return d ? `📅 ${d} — ${c.message}` : c.message;
            }).join('\n');
        }
        
        if (bilanData.campaignList && bilanData.campaignList.length > 1) {
            // Multi-campagnes : remplir chaque textarea
            for (const camp of bilanData.campaignList) {
                const campComments = comments[String(camp.id)] || [];
                const text = formatComments(campComments);
                const textarea = document.getElementById('bilanAnalysisContext_' + camp.id);
                if (textarea && text) {
                    textarea.value = textarea.value ? textarea.value + '\n\n' + text : text;
                    bilanData.analysisContextPerCampaign[camp.id] = textarea.value;
                }
            }
        } else {
            // Mono-campagne : fusionner tous les commentaires dans le textarea unique
            const allComments = Object.values(comments).flat();
            const text = formatComments(allComments);
            const textarea = document.getElementById('bilanAnalysisContext');
            if (textarea && text) {
                textarea.value = textarea.value ? textarea.value + '\n\n' + text : text;
                bilanData.analysisContext = textarea.value;
            }
        }
        
        const totalCount = Object.values(comments).reduce((s, arr) => s + arr.length, 0);
        if (totalCount > 0) bilanData._commentsLoaded = true;
        if (status) {
            status.textContent = totalCount > 0 ? `✅ ${totalCount} commentaire(s) chargé(s)` : '⚠️ Aucun commentaire';
            status.style.color = totalCount > 0 ? '#16a34a' : '#d97706';
        }
        
    } catch (e) {
        console.error('Erreur chargement commentaires ADX:', e);
        if (status) { status.textContent = '❌ Erreur chargement'; status.style.color = '#dc2626'; }
    }
}

// ============================================
// ACTIONS — FICHIERS STATS (multi-fichiers)
// ============================================

/**
 * Gère le drop de fichiers stats (multi)
 */
function handleStatsFilesDrop(event) {
    event.preventDefault();
    event.target.closest('.bilan-upload-zone')?.classList.remove('dragover');
    const files = event.dataTransfer.files;
    if (files.length > 0) processStatsFiles(files);
}

/**
 * Gère la sélection de fichiers via input (multi)
 */
function handleStatsFilesSelect(files) {
    if (files.length > 0) processStatsFiles(files);
}

/**
 * Parse un ou plusieurs fichiers Excel/CSV et les ajoute à bilanData.statsFiles
 */
function processStatsFiles(fileList) {
    const validExts = ['.xlsx', '.xls', '.csv'];
    let processed = 0;
    const total = fileList.length;
    
    for (const file of fileList) {
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        if (!validExts.includes(ext)) {
            showBilanNotification(`"${file.name}" ignoré — format non supporté.`, 'warning');
            processed++;
            continue;
        }
        
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array', raw: false });
                
                // Parcourir toutes les feuilles du workbook
                for (const sheetName of workbook.SheetNames) {
                    const sheet = workbook.Sheets[sheetName];
                    const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
                    
                    if (jsonData.length < 2) continue;
                    
                    const headers = jsonData[0].map(h => String(h).trim());
                    const rows = jsonData.slice(1)
                        .filter(row => row.some(cell => cell !== ''))
                        .map(row => row.map(cell => String(cell).trim()));
                    
                    if (rows.length === 0) continue;
                    
                    const kpis = computeKPIs(headers, rows);
                    
                    bilanData.statsFiles.push({
                        name: file.name,
                        sheetName: workbook.SheetNames.length > 1 ? sheetName : '',
                        headers: headers,
                        rows: rows,
                        kpis: kpis
                    });
                }
                
                processed++;
                if (processed === total) {
                    showBilanNotification(`${bilanData.statsFiles.length} source${bilanData.statsFiles.length > 1 ? 's' : ''} chargée${bilanData.statsFiles.length > 1 ? 's' : ''}.`, 'success');
                    renderBilanFilesList();
                }
            } catch (error) {
                console.error('Erreur parsing:', file.name, error);
                showBilanNotification(`Erreur lecture "${file.name}" : ${error.message}`, 'error');
                processed++;
            }
        };
        reader.readAsArrayBuffer(file);
    }
}

/**
 * Calcule les KPIs automatiques à partir des headers et rows
 */
function computeKPIs(headers, rows) {
    const kpis = {};
    headers.forEach((header, colIdx) => {
        if (colIdx === 0) return;
        const numericValues = rows.map(row => {
            const val = (row[colIdx] || '').replace(/[€$£%\s]/g, '').replace(',', '.');
            return parseFloat(val);
        }).filter(v => !isNaN(v));
        
        if (numericValues.length > 0) {
            const total = numericValues.reduce((a, b) => a + b, 0);
            const isPercent = rows.some(row => (row[colIdx] || '').includes('%'));
            if (isPercent) {
                kpis[header] = (total / numericValues.length).toFixed(2) + '%';
            } else {
                kpis[header] = total;
            }
        }
    });
    return kpis;
}

/**
 * Affiche la liste des fichiers chargés dans l'étape 1
 */
function renderBilanFilesList() {
    const container = document.getElementById('bilanFilesList');
    if (!container) return;
    
    if (bilanData.statsFiles.length === 0) {
        container.innerHTML = '';
        return;
    }
    
    container.innerHTML = `
        <div class="bilan-files-list">
            ${bilanData.statsFiles.map((f, i) => `
                <div class="bilan-file-item">
                    <div class="bilan-file-info">
                        <span class="bilan-file-icon">📄</span>
                        <span class="bilan-file-name">${f.name}${f.sheetName ? ' — ' + f.sheetName : ''}</span>
                        <span class="bilan-file-meta">${f.rows.length} lignes, ${f.headers.length} colonnes</span>
                    </div>
                    <button class="bilan-file-remove" onclick="removeBilanStatsFile(${i})" title="Supprimer">✕</button>
                </div>
            `).join('')}
        </div>
    `;
}

/**
 * Supprime un fichier stats de la liste
 */
function removeBilanStatsFile(index) {
    bilanData.statsFiles.splice(index, 1);
    renderBilanFilesList();
}

/**
 * Valide l'étape 1 et passe à l'étape 2
 */
async function validateAndGoStep2() {
    bilanData.date = '';
    bilanData.campaignIds = document.getElementById('bilanCampaignIds')?.value.trim() || '';
    bilanData.dateFrom = document.getElementById('bilanDateFrom')?.value || '';
    bilanData.dateTo = document.getElementById('bilanDateTo')?.value || '';
    
    
    if (!bilanData.campaignIds) {
        showBilanNotification('Veuillez entrer au moins un ID de campagne.', 'warning');
        return;
    }
    if (bilanData.selectedStatFields.length === 0) {
        showBilanNotification('Veuillez sélectionner au moins une métrique.', 'warning');
        return;
    }
    if (bilanData.selectedViews.length === 0) {
        showBilanNotification('Veuillez sélectionner au moins une vue à générer.', 'warning');
        return;
    }
    
    await fetchApiStats();
}

/**
 * Appelle le backend pour récupérer les stats via l'API externe
 */
async function fetchApiStats() {
    const btn = document.getElementById('bilanStep1Btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="bilan-spinner"></span> Récupération en cours...';
    }
    
    const campaignIds = bilanData.campaignIds.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
    
    try {
        // Récupérer l'objectiveId depuis le mapping si un objectif spécifique est sélectionné
        const selectedObjectiveId = (bilanData.selectedObjective && bilanData.selectedObjective !== 'all') 
            ? bilanData.objectivesMapping[bilanData.selectedObjective] 
            : null;

        const response = await fetch('/api/bilan/fetch-stats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                campaignIds,
                dateFrom: bilanData.dateFrom,
                dateTo: bilanData.dateTo,
                statisticFields: bilanData.selectedStatFields,
                selectedViews: bilanData.selectedViews,
                multiObjectifs: bilanData.multiObjectifs,
                selectedObjective: bilanData.selectedObjective,
                selectedObjectiveId: selectedObjectiveId,
                detailCiblage: bilanData.detailCiblage
            })
        });
        
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || 'Erreur serveur ' + response.status);
        }
        
        const result = await response.json();
        
        if (!result.headers || !result.rows || result.rows.length === 0) {
            throw new Error('Aucune donnée retournée par l\'API pour ces campagnes.');
        }
        
        // Stocker le nom de campagne (info client, pour Excel uniquement, PAS pour Claude)
        if (result.campaignName) {
            bilanData.apiCampaignName = result.campaignName;
        }
        // Stocker la liste des campagnes (pour commentaires par campagne)
        bilanData.campaignList = result.campaignList || [];
        
        // Injecter les vues sélectionnées dans bilanData.statsFiles
        bilanData.statsFiles = [];
        
        // Si multi-objectifs ET "Tous les objectifs" sélectionné → créer des subdivisions
        // Si objectif spécifique sélectionné → format simple (déjà filtré côté backend)
        const createSubdivisions = result.multiObjectifs && result.subdivisionsList?.length && bilanData.selectedObjective === 'all';
        
        if (createSubdivisions) {
            // Multi-objectifs : créer un statsFile par subdivision par vue
            bilanData._subdivisionsList = result.subdivisionsList;
            bilanData._subdivisions = result.subdivisions;
            
            // Créer les fichiers stats par subdivision
            for (let i = 0; i < result.subdivisionsList.length; i++) {
                const subName = result.subdivisionsList[i];
                const subData = result.subdivisions[subName];
                const suffix = ` (${subName})`;
                const sIdx = i + 1; // 1-indexed
                if (subData.global?.rows?.length) bilanData.statsFiles.push({ name: 'Global' + suffix, sheetName: 'GLOBAL', subdivisionIndex: sIdx, subdivisionName: subName, headers: subData.global.headers, rows: subData.global.rows, kpis: {} });
                if (subData.formats?.rows?.length) bilanData.statsFiles.push({ name: 'Formats' + suffix, sheetName: 'FORMATS', subdivisionIndex: sIdx, subdivisionName: subName, headers: subData.formats.headers, rows: subData.formats.rows, kpis: {} });
                if (subData.ciblages?.rows?.length) bilanData.statsFiles.push({ name: 'Ciblages' + suffix, sheetName: 'CIBLAGES', subdivisionIndex: sIdx, subdivisionName: subName, headers: subData.ciblages.headers, rows: subData.ciblages.rows, kpis: {} });
                if (subData.creatives?.rows?.length) bilanData.statsFiles.push({ name: 'Créatives' + suffix, sheetName: 'CREATIVES', subdivisionIndex: sIdx, subdivisionName: subName, headers: subData.creatives.headers, rows: subData.creatives.rows, kpis: {} });
                if (subData.poi?.rows?.length) bilanData.statsFiles.push({ name: 'POI' + suffix, sheetName: 'POI', subdivisionIndex: sIdx, subdivisionName: subName, headers: subData.poi.headers, rows: subData.poi.rows, kpis: {} });
                if (subData.device?.rows?.length) bilanData.statsFiles.push({ name: 'Device' + suffix, sheetName: 'DEVICE', subdivisionIndex: sIdx, subdivisionName: subName, headers: subData.device.headers, rows: subData.device.rows, kpis: {} });
                if (subData.os?.rows?.length) bilanData.statsFiles.push({ name: 'OS' + suffix, sheetName: 'OS', subdivisionIndex: sIdx, subdivisionName: subName, headers: subData.os.headers, rows: subData.os.rows, kpis: {} });
                if (subData.capping?.rows?.length) bilanData.statsFiles.push({ name: 'Capping Group' + suffix, sheetName: 'CAPPING', subdivisionIndex: sIdx, subdivisionName: subName, headers: subData.capping.headers, rows: subData.capping.rows, kpis: {} });
            }
        } else {
            // Format simple : pas de subdivisions (soit pas multi-objectifs, soit objectif spécifique sélectionné)
            if (result.multiObjectifs && result.subdivisionsList?.length) {
                bilanData._subdivisionsList = result.subdivisionsList;
                bilanData._subdivisions = result.subdivisions;
            }
            
            if (result.global?.rows?.length) bilanData.statsFiles.push({ name: 'Global', sheetName: 'GLOBAL', headers: result.global.headers, rows: result.global.rows, kpis: {} });
            
            // Autres vues
            if (result.formats?.rows?.length) bilanData.statsFiles.push({ name: 'Formats', sheetName: 'FORMATS', headers: result.formats.headers, rows: result.formats.rows, kpis: {} });
            if (result.ciblages?.rows?.length) bilanData.statsFiles.push({ name: 'Ciblages', sheetName: 'CIBLAGES', headers: result.ciblages.headers, rows: result.ciblages.rows, kpis: {} });
            if (result.creatives?.rows?.length) bilanData.statsFiles.push({ name: 'Créatives', sheetName: 'CREATIVES', headers: result.creatives.headers, rows: result.creatives.rows, kpis: {} });
            if (result.poi?.rows?.length) bilanData.statsFiles.push({ name: 'POI', sheetName: 'POI', headers: result.poi.headers, rows: result.poi.rows, kpis: {} });
            if (result.device?.rows?.length) bilanData.statsFiles.push({ name: 'Device', sheetName: 'DEVICE', headers: result.device.headers, rows: result.device.rows, kpis: {} });
            if (result.os?.rows?.length) bilanData.statsFiles.push({ name: 'OS', sheetName: 'OS', headers: result.os.headers, rows: result.os.rows, kpis: {} });
            if (result.capping?.rows?.length) {
                console.log(`📊 FRONTEND: Capping data reçu - ${result.capping.rows.length} rows`, result.capping.headers, result.capping.rows);
                bilanData.statsFiles.push({ name: 'Capping Group', sheetName: 'CAPPING', headers: result.capping.headers, rows: result.capping.rows, kpis: {} });
            } else {
                console.log(`⚠️ FRONTEND: Pas de données capping reçues - result.capping:`, result.capping);
            }
        }
        // Reach : toujours ajouter comme onglet séparé (pas multi-objectifs)
        if (result.reach?.rows?.length) {
            bilanData.statsFiles.push({ name: 'Reach', sheetName: 'REACH', headers: result.reach.headers, rows: result.reach.rows, kpis: {} });
            bilanData.totalReachUsers = result.reach.totalReachUsers || 0;
            bilanData.totalReachImpressions = result.reach.totalReachImpressions || 0;
            bilanData.avgReachRepeatRate = result.reach.avgReachRepeatRate || 0;
        }
        
        // Mettre à jour la date du bilan
        bilanData.date = `DU ${formatDateFR(bilanData.dateFrom)} AU ${formatDateFR(bilanData.dateTo)}`;
        
        const s = result.summary || {};
        showBilanNotification(
            `${s.uniqueDays || '?'} jours | ${s.formats || 0} formats | ${s.ciblages || 0} ciblages | ${(s.totalImpressions || 0).toLocaleString()} impr | CTR ${s.ctr || '—'}`,
            'success'
        );
        
        // Stocker pour export
        bilanData._apiRawHeaders = result.headers;
        bilanData._apiRawRows = result.rows;
        bilanData._apiRawRecords = result.rawRecords || null;
        bilanData._apiViews = { global: result.global, formats: result.formats, ciblages: result.ciblages, creatives: result.creatives, codemonocle: result.codemonocle, poi: result.poi, device: result.device, os: result.os, capping: result.capping, reach: result.reach };
        
        console.log(`📋 FRONTEND: bilanData.statsFiles final (${bilanData.statsFiles.length} fichiers):`, bilanData.statsFiles.map(f => `${f.name} (${f.rows.length} rows)`));
        // Stocker données agrégées (tous breakdowns combinés) pour bilan poussé
        if (result.aggregated?.rows?.length) {
            bilanData._aggregatedData = { headers: result.aggregated.headers, rows: result.aggregated.rows };
            console.log(`📊 Données agrégées stockées: ${result.aggregated.rows.length} lignes`);
        }
        // Stocker le fichier Excel agrégé (disponible dès maintenant)
        if (result.aggBase64) {
            bilanData._aggBase64 = result.aggBase64;
            bilanData._aggFileName = result.aggFileName;
        }
        
        // Notify user if some stat fields were auto-removed (invalid for this campaign)
        if (result.removedStatFields && result.removedStatFields.length > 0) {
            const labels = result.removedStatFields.map(k => {
                const cfg = bilanData.apiStatFieldsConfig?.categories?.flatMap(c => c.fields).find(f => f.key === k);
                return cfg ? cfg.label : k;
            });
            showBilanNotification(`⚠️ Colonnes indisponibles retirées automatiquement : ${labels.join(', ')}`, 'warning');
            // Remove from selected so they aren't sent again on generate
            bilanData.selectedStatFields = bilanData.selectedStatFields.filter(f => !result.removedStatFields.includes(f));
        }
        
        // En mode API, directement au choix du template
        renderBilanStep3();
        
    } catch (error) {
        showBilanNotification('Erreur API : ' + error.message, 'error');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span>🚀</span> Récupérer les statistiques';
        }
    }
}

/**
 * Formate une date YYYY-MM-DD en DD/MM/YYYY
 */
function formatDateFR(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

// ============================================
// ACTIONS — TEMPLATE
// ============================================

/**
 * Gère le drop d'un template
 */
function handleTemplateDrop(event) {
    event.preventDefault();
    event.target.closest('.bilan-upload-zone')?.classList.remove('dragover');
    const file = event.dataTransfer.files[0];
    if (file) handleTemplateUpload(file);
}

/**
 * Gère l'upload d'un template Excel
 */
function handleTemplateUpload(file) {
    if (!file) return;
    
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!['.xlsx', '.xls'].includes(ext)) {
        showBilanNotification('Format non supporté. Utilisez XLSX ou XLS.', 'error');
        return;
    }
    
    bilanData.selectedTemplate = 'custom';
    bilanData.customTemplateFile = file;
    
    // Parser le template pour envoyer sa structure au backend
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array', raw: false });
            bilanData.templateData = {};
            for (const sheetName of workbook.SheetNames) {
                const sheet = workbook.Sheets[sheetName];
                bilanData.templateData[sheetName] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
            }
            showBilanNotification(`Template "${file.name}" chargé (${workbook.SheetNames.length} feuille${workbook.SheetNames.length > 1 ? 's' : ''}).`, 'success');
            renderBilanStep3();
        } catch (error) {
            showBilanNotification('Erreur lecture template : ' + error.message, 'error');
        }
    };
    reader.readAsArrayBuffer(file);
}

// ============================================
// ACTIONS — GÉNÉRATION
// ============================================

/**
 * Génère le bilan via le proxy Railway → API Claude
 * Affiche une progression animée pendant l'attente, puis le résultat
 */
async function generateBilan() {
    const isPousse = bilanData.wantAnalysis && bilanData.analysisType === 'pousse';
    
    // Remplacer le contenu par la progression
    const container = document.getElementById('bilanContainer');
    if (container) {
        container.innerHTML = `
            <div class="bilan-container">
                <div class="bilan-header-nav">
                    <div>
                        <h2>🤖 Génération en cours</h2>
                        <p>${bilanData.title}</p>
                    </div>
                </div>
                ${renderStepper(4)}
                <div id="bilanGenerationZone" style="margin-top: 25px;">
                    <div class="bilan-progress-zone">
                        <div class="bilan-progress-bar-container">
                            <div class="bilan-progress-bar" id="bilanProgressBar" style="width: 5%"></div>
                        </div>
                        <p class="bilan-progress-text" id="bilanProgressText">Récupération des données ADX...</p>
                        <p class="bilan-progress-percent" id="bilanProgressPercent">5%</p>
                    </div>
                </div>
                <div id="bilanQuestionZone" style="display: none; margin-top: 25px;"></div>
                <div id="bilanResult" style="display: none; margin-top: 25px;"></div>
            </div>
        `;
    }
    
    const genZone = document.getElementById('bilanGenerationZone');
    
    const allStats = bilanData.statsFiles.map(f => ({
        name: f.name,
        sheetName: f.sheetName,
        headers: f.headers,
        rows: f.rows,
        subdivisionIndex: f.subdivisionIndex || null,
        subdivisionName: f.subdivisionName || null
    }));
    
    try {
        // --- ÉTAPE 1 : Génération Excel ---
        updateBilanProgress(10, 'Génération du template Excel...');
        
        const editableMap = bilanData.templateData ? extractEditableCells(bilanData.templateData) : null;
        
        // Pour le bilan poussé, ne pas envoyer wantAnalysis au generate (l'analyse est séparée)
        const response = await fetch('/api/bilan/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                title: bilanData.title,
                objectif: bilanData.objectif,
                cpc: bilanData.cpc,
                date: bilanData.date,
                apiCampaignName: bilanData.apiCampaignName || '',
                dateFrom: bilanData.dateFrom || '',
                dateTo: bilanData.dateTo || '',
                stats: allStats,
                editableMap: editableMap,
                templatePath: bilanData.selectedTemplatePath || null,
                templateName: bilanData.customTemplateFile?.name || 'template',
                customPrompt: bilanData.customPrompt,
                subdivisions: bilanData.subdivisions,
                topDiffPerf: bilanData.topDiffPerf,
                totalReachUsers: bilanData.totalReachUsers || 0,
                wantAnalysis: isPousse ? false : bilanData.wantAnalysis,
                analysisType: bilanData.analysisType,
                analysisContext: bilanData.analysisContext,
                aggregatedData: bilanData._aggregatedData || null
            })
        });
        
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || 'Erreur serveur ' + response.status);
        }
        
        const result = await response.json();
        
        // --- Mismatch subdivisions : proposer split par date ---
        if (result.subdivisionMismatch) {
            updateBilanProgress(15, 'Vérification des subdivisions...');
            const questionZone = document.getElementById('bilanQuestionZone');
            if (questionZone) {
                questionZone.style.display = 'block';
                const datesHtml = result.textSubdivisions?.map(d => 
                    `<li><strong>${d.name}</strong>${d.dateFrom ? ` : ${d.dateFrom} → ${d.dateTo}` : ' (pas de dates)'}</li>`
                ).join('') || '';
                questionZone.innerHTML = `
                    <div class="bilan-generate-zone" style="border: 2px solid #f0ad4e; border-radius: 8px; padding: 20px;">
                        <div class="icon">⚠️</div>
                        <h3 style="color: #f0ad4e;">Subdivisions non trouvées dans les données</h3>
                        <p>${result.message}</p>
                        ${result.canSplitByDate ? `
                            <p style="margin-top: 10px;">Les dates sont disponibles dans le texte :</p>
                            <ul style="text-align: left; margin: 10px auto; max-width: 400px;">${datesHtml}</ul>
                            <p>Voulez-vous <strong>séparer les données par plage de dates</strong> pour remplir chaque onglet ?</p>
                            <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: center;">
                                <button onclick="_bilanResolveMismatch(true)" class="bilan-btn-inline" style="background: #28a745; color: white;">
                                    ✅ Oui, séparer par dates
                                </button>
                                <button onclick="_bilanResolveMismatch(false)" class="bilan-btn-inline" style="background: #6c757d; color: white;">
                                    ❌ Non, continuer normalement
                                </button>
                            </div>
                        ` : `
                            <p style="margin-top: 10px;">Pas de dates dans le texte, impossible de séparer automatiquement.</p>
                            <button onclick="_bilanResolveMismatch(false)" class="bilan-btn-inline" style="margin-top: 10px;">
                                Continuer la génération
                            </button>
                        `}
                    </div>
                `;
            }
            // Attendre la réponse utilisateur via une promesse
            const userChoice = await new Promise(resolve => { window._bilanResolveMismatch = resolve; });
            if (questionZone) questionZone.style.display = 'none';
            
            // Re-appeler generate avec le choix
            updateBilanProgress(20, userChoice ? 'Séparation par dates...' : 'Génération sans séparation...');
            const response2 = await fetch('/api/bilan/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    title: bilanData.title, objectif: bilanData.objectif, cpc: bilanData.cpc, date: bilanData.date,
                    apiCampaignName: bilanData.apiCampaignName || '', dateFrom: bilanData.dateFrom || '', dateTo: bilanData.dateTo || '',
                    stats: allStats, editableMap: editableMap,
                    templatePath: bilanData.selectedTemplatePath || null,
                    templateName: bilanData.customTemplateFile?.name || 'template',
                    customPrompt: bilanData.customPrompt, subdivisions: bilanData.subdivisions,
                    topDiffPerf: bilanData.topDiffPerf,
                    totalReachUsers: bilanData.totalReachUsers || 0,
                    wantAnalysis: isPousse ? false : bilanData.wantAnalysis,
                    analysisType: bilanData.analysisType, analysisContext: bilanData.analysisContext,
                    splitByDate: userChoice ? true : false,
                    skipMismatchCheck: !userChoice,
                    aggregatedData: bilanData._aggregatedData || null
                })
            });
            if (!response2.ok) {
                const err = await response2.json().catch(() => ({}));
                throw new Error(err.message || 'Erreur serveur ' + response2.status);
            }
            const result2 = await response2.json();
            bilanData.generatedBilan = result2;
            updateBilanProgress(40, 'Template Excel généré');
            if (result2.claudeSkipped) {
                showBilanNotification('L\'IA était temporairement indisponible pour les KPIs Excel. <a href="https://status.claude.com/" target="_blank">Statut Claude</a>', 'warning');
            }
            // Continue to ÉTAPE 2 below with result2
            if (isPousse) {
                updateBilanProgress(50, 'Lancement de l\'analyse Claude...');
                await runPousseAnalysis(allStats);
            } else {
                if (result2.analysis) bilanData.analysisResult = result2.analysis;
                updateBilanProgress(100, 'Terminé !');
                setTimeout(() => showBilanResult(result2), 500);
            }
            return;
        }
        
        bilanData.generatedBilan = result;
        updateBilanProgress(40, 'Template Excel généré');
        
        if (result.claudeSkipped) {
            showBilanNotification('L\'IA était temporairement indisponible pour les KPIs Excel. <a href="https://status.claude.com/" target="_blank">Statut Claude</a>', 'warning');
        }
        
        // --- ÉTAPE 2 : Bilan poussé → analyse conversationnelle ---
        if (isPousse) {
            updateBilanProgress(50, 'Lancement de l\'analyse Claude...');
            
            await runPousseAnalysis(allStats);
        } else {
            // Bilan simple : afficher le résultat directement
            if (result.analysis) bilanData.analysisResult = result.analysis;
            updateBilanProgress(100, 'Terminé !');
            setTimeout(() => showBilanResult(result), 500);
        }
        
    } catch (error) {
        showBilanNotification('Erreur : ' + error.message, 'error');
        if (genZone) {
            genZone.innerHTML = `
                <div class="bilan-generate-zone">
                    <div class="icon">❌</div>
                    <h3 style="color: #dc3545;">Erreur</h3>
                    <p>${error.message}</p>
                    <button onclick="generateBilan()" id="bilanGenerateBtn" class="bilan-btn-inline">
                        <span>🔄</span> Réessayer
                    </button>
                </div>
            `;
        }
    }
}

/**
 * Rendu des étapes de génération (barre stepped)
 */
function renderGenerationSteps(isPousse) {
    const steps = [
        { id: 'step-adx', label: 'Récupération data ADX', icon: '📡' },
        ...(isPousse ? [
            { id: 'step-agreg', label: 'Agrégation des données', icon: '📊' },
            { id: 'step-analyse', label: 'Analyse Claude', icon: '🤖' },
            { id: 'step-questions', label: 'Questions Claude', icon: '💬' },
            { id: 'step-result', label: 'Résultat final', icon: '✅' }
        ] : [
            { id: 'step-result', label: 'Résultat final', icon: '✅' }
        ])
    ];
    
    return `
        <div class="bilan-gen-steps">
            ${steps.map(s => `
                <div class="bilan-gen-step" id="${s.id}">
                    <span class="bilan-gen-step-icon">${s.icon}</span>
                    <span class="bilan-gen-step-label">${s.label}</span>
                    <span class="bilan-gen-step-status">⏳</span>
                </div>
            `).join('')}
        </div>
    `;
}

function updateGenerationStep(stepId, status) {
    const el = document.getElementById(stepId);
    if (!el) return;
    const statusEl = el.querySelector('.bilan-gen-step-status');
    if (!statusEl) return;
    el.classList.remove('active', 'done', 'error');
    el.classList.add(status);
    if (status === 'done') statusEl.textContent = '✅';
    else if (status === 'active') statusEl.textContent = '⏳';
    else if (status === 'error') statusEl.textContent = '❌';
    else if (status === 'skipped') statusEl.textContent = '⏭️';
}

/**
 * Flow bilan poussé : appel /api/bilan/analysis avec support Q&A
 */
async function runPousseAnalysis(allStats, existingMessages = [], round = 0) {
    const maxRounds = 3;
    
    updateBilanProgress(60, 'Analyse Claude en cours...');
    
    try {
        const response = await fetch('/api/bilan/analysis', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                title: bilanData.title,
                objectif: bilanData.objectif,
                cpc: bilanData.cpc,
                date: bilanData.date,
                dateFrom: bilanData.dateFrom || '',
                dateTo: bilanData.dateTo || '',
                stats: allStats,
                subdivisions: bilanData.subdivisions,
                analysisContext: bilanData.analysisContext,
                totalReachUsers: bilanData.totalReachUsers || 0,
                totalReachImpressions: bilanData.totalReachImpressions || 0,
                avgReachRepeatRate: bilanData.avgReachRepeatRate || 0,
                analysisType: 'pousse',
                messages: existingMessages,
                aggregatedData: bilanData._aggregatedData || null
            })
        });
        
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || 'Erreur analyse ' + response.status);
        }
        
        const result = await response.json();
        
        // Stocker le fichier agrégé
        if (result.aggBase64) {
            bilanData._aggBase64 = result.aggBase64;
            bilanData._aggFileName = result.aggFileName;
        }
        
        // Claude pose des questions ?
        if (result.status === 'questions' && round < maxRounds) {
            updateBilanProgress(75, 'Claude a des questions...');
            
            // Afficher les questions et attendre la réponse
            showClaudeQuestions(result, allStats, existingMessages, round);
            return;
        }
        
        // Claude n'a pas de questions → relancer pour obtenir l'analyse directement
        if (result.status === 'no_questions') {
            updateBilanProgress(80, 'Rédaction de l\'analyse...');
            const noQMsg = [
                { role: 'assistant', content: '[NO_QUESTIONS]' },
                { role: 'user', content: 'Pas de questions nécessaires. Rédige l\'analyse complète maintenant.' }
            ];
            runPousseAnalysis(allStats, [...existingMessages, ...noQMsg], round + 1);
            return;
        }
        
        // Analyse complète
        updateBilanProgress(100, 'Analyse terminée !');
        
        bilanData.analysisResult = result.analysis || result.message || '';
        
        setTimeout(() => showPousseResult(result), 500);
        
    } catch (error) {
        showBilanNotification('Erreur analyse : ' + error.message, 'error');
        // Afficher quand même le résultat Excel
        showPousseResult({ status: 'error', message: error.message });
    }
}

/**
 * Affiche les questions de Claude dans un chat-like UI
 */
function showClaudeQuestions(result, allStats, existingMessages, round) {
    const zone = document.getElementById('bilanQuestionZone');
    if (!zone) return;
    zone.style.display = 'block';
    
    // Masquer la barre de progression
    const genZone = document.getElementById('bilanGenerationZone');
    if (genZone) genZone.style.display = 'none';
    
    zone.innerHTML = `
        <div class="bilan-card">
            <div class="bilan-chat-bubble claude">
                <div class="bilan-chat-avatar">🤖</div>
                <div class="bilan-chat-content">
                    <strong>Claude a besoin de précisions (${round + 1}/${3})</strong>
                    <div class="bilan-chat-text">${markdownToHtml(result.questions)}</div>
                </div>
            </div>
            <div class="bilan-chat-reply" style="margin-top: 16px;">
                <textarea id="bilanClaudeReply" class="bilan-input" rows="4" 
                    placeholder="Répondez aux questions de Claude..."></textarea>
                <div style="display: flex; gap: 10px; margin-top: 12px;">
                    <button onclick="submitClaudeReply(${round})" class="bilan-btn-primary" id="btnSubmitReply">
                        💬 Répondre et continuer
                    </button>
                    <button onclick="skipClaudeQuestions(${round})" class="bilan-btn-secondary">
                        ⏭️ Ignorer et finaliser
                    </button>
                </div>
            </div>
        </div>
    `;
    initAnalysisCharts();
    
    // Stocker le contexte pour le submit
    bilanData._pousseContext = { allStats, existingMessages, claudeMessage: result.claudeMessage };
}

function submitClaudeReply(round) {
    const reply = document.getElementById('bilanClaudeReply')?.value?.trim();
    if (!reply) {
        showBilanNotification('Veuillez saisir une réponse', 'warning');
        return;
    }
    
    const btn = document.getElementById('btnSubmitReply');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Envoi...'; }
    
    const ctx = bilanData._pousseContext;
    if (!ctx) return;
    
    // Ajouter le message Claude + la réponse utilisateur à l'historique
    const newMessages = [
        ...ctx.existingMessages,
        { role: 'assistant', content: ctx.claudeMessage },
        { role: 'user', content: reply }
    ];
    
    // Remettre la zone de progression
    const zone = document.getElementById('bilanQuestionZone');
    if (zone) zone.style.display = 'none';
    const genZone = document.getElementById('bilanGenerationZone');
    if (genZone) genZone.style.display = 'block';
    
    runPousseAnalysis(ctx.allStats, newMessages, round + 1);
}

function skipClaudeQuestions(round) {
    const ctx = bilanData._pousseContext;
    if (!ctx) return;
    
    // Envoyer "Pas de réponse supplémentaire, finalise l'analyse" 
    const newMessages = [
        ...ctx.existingMessages,
        { role: 'assistant', content: ctx.claudeMessage },
        { role: 'user', content: 'Pas de réponse supplémentaire. Merci de finaliser l\'analyse avec les informations disponibles.' }
    ];
    
    const zone = document.getElementById('bilanQuestionZone');
    if (zone) zone.style.display = 'none';
    const genZone = document.getElementById('bilanGenerationZone');
    if (genZone) genZone.style.display = 'block';
    
    runPousseAnalysis(ctx.allStats, newMessages, round + 1);
}

/**
 * Affiche le résultat final du bilan poussé (Excel + agrégé + analyse)
 */
function showPousseResult(analysisResult) {
    const resultZone = document.getElementById('bilanResult');
    if (!resultZone) return;
    resultZone.style.display = 'block';
    
    // Masquer la progression
    const genZone = document.getElementById('bilanGenerationZone');
    if (genZone) genZone.style.display = 'none';
    
    const hasExcel = bilanData.generatedBilan?.fileBase64;
    const hasAgg = bilanData._aggBase64;
    const analysisText = analysisResult.analysis || bilanData.analysisResult || '';
    
    const analysisHtml = analysisText ? `
        <div class="bilan-analysis-result" style="margin-top: 20px;">
            <h4>📊 Analyse approfondie de la campagne</h4>
            <div class="bilan-analysis-content">${markdownToHtml(analysisText)}</div>
            <button onclick="copyAnalysis()" class="bilan-btn-secondary" style="margin-top: 12px;">
                📋 Copier l'analyse
            </button>
        </div>
    ` : (analysisResult.status === 'error' ? `
        <div class="bilan-analysis-result" style="margin-top: 20px;">
            <h4 style="color: #f59e0b;">⚠️ Analyse indisponible</h4>
            <p>${analysisResult.message || 'Claude n\'a pas pu générer l\'analyse.'}</p>
        </div>
    ` : '');
    
    resultZone.innerHTML = `
        <div class="bilan-result">
            <div class="bilan-result-header">
                <span style="font-size: 1.5em;">✅</span>
                <h3>Bilan poussé généré avec succès</h3>
            </div>
            <p style="color: #6c757d; margin-bottom: 20px;"><strong>${bilanData.title}</strong> — ${bilanData.date}</p>
            <div class="bilan-result-actions">
                ${hasExcel ? `<button onclick="downloadBilanExcel()" class="bilan-btn-primary">
                    📥 Télécharger le bilan Excel
                </button>` : ''}
                ${renderExportMenuHtml()}
                <button onclick="renderBilanStep1()" class="bilan-btn-secondary">
                    🔄 Nouveau bilan
                </button>
            </div>
            <div style="display:flex;gap:10px;justify-content:center;margin-top:10px;">
                <button onclick="downloadDashboardHTML('simple')" style="background:none;border:none;color:#94a3b8;font-size:0.78em;cursor:pointer;text-decoration:underline;padding:4px 8px;">
                    🌐 Dashboard simple
                </button>
                ${bilanData._aggregatedData ? `<button onclick="downloadDashboardHTML('complete')" style="background:none;border:none;color:#94a3b8;font-size:0.78em;cursor:pointer;text-decoration:underline;padding:4px 8px;">
                    🌐 Dashboard complet
                </button>` : ''}
            </div>
            ${analysisHtml}
        </div>
    `;
    initAnalysisCharts();
}

function downloadAggregatedFile() {
    if (!bilanData._aggBase64 || !bilanData._aggFileName) {
        showBilanNotification('Aucun fichier agrégé disponible.', 'warning');
        return;
    }
    const bytes = atob(bilanData._aggBase64);
    const buffer = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i);
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = bilanData._aggFileName;
    a.click();
    URL.revokeObjectURL(url);
    showBilanNotification(`Fichier "${bilanData._aggFileName}" téléchargé.`, 'success');
}

/**
 * Met à jour la barre de progression
 */
function updateBilanProgress(percent, message) {
    const bar = document.getElementById('bilanProgressBar');
    const text = document.getElementById('bilanProgressText');
    const pct = document.getElementById('bilanProgressPercent');
    
    if (bar) bar.style.width = percent + '%';
    if (text) text.textContent = message;
    if (pct) pct.textContent = percent + '%';
}

/**
 * Affiche le résultat final après génération
 */
function showBilanResult(result) {
    const resultZone = document.getElementById('bilanResult');
    if (!resultZone) return;
    
    resultZone.style.display = 'block';
    
    if (result && (result.fileBase64 || (result.sheets && Object.keys(result.sheets).length > 0))) {
        bilanData.generatedBilan = result;
        if (result.analysis) bilanData.analysisResult = result.analysis;
        
        const analysisHtml = result.analysis ? `
            <div class="bilan-analysis-result">
                <h4>📊 Analyse de la campagne</h4>
                <div class="bilan-analysis-content">${markdownToHtml(result.analysis)}</div>
                <button onclick="copyAnalysis()" class="bilan-btn-secondary" style="margin-top: 12px;">
                    📋 Copier l'analyse
                </button>
            </div>
        ` : '';
        
        resultZone.innerHTML = `
            <div class="bilan-result">
                <div class="bilan-result-header">
                    <span style="font-size: 1.5em;">✅</span>
                    <h3>Bilan généré avec succès</h3>
                </div>
                <p style="color: #6c757d; margin-bottom: 20px;"><strong>${bilanData.title}</strong> — ${bilanData.date}</p>
                <div class="bilan-result-actions">
                    <button onclick="downloadBilanExcel()" class="bilan-btn-primary">
                        📥 Télécharger le bilan Excel
                    </button>
                    ${renderExportMenuHtml()}
                    <button onclick="renderBilanStep1()" class="bilan-btn-secondary">
                        🔄 Nouveau bilan
                    </button>
                </div>
                <div style="display:flex;gap:10px;justify-content:center;margin-top:10px;">
                    <button onclick="downloadDashboardHTML('simple')" style="background:none;border:none;color:#94a3b8;font-size:0.78em;cursor:pointer;text-decoration:underline;padding:4px 8px;">
                        🌐 Dashboard simple
                    </button>
                    ${bilanData._aggregatedData ? `<button onclick="downloadDashboardHTML('complete')" style="background:none;border:none;color:#94a3b8;font-size:0.78em;cursor:pointer;text-decoration:underline;padding:4px 8px;">
                        🌐 Dashboard complet
                    </button>` : ''}
                </div>
                ${analysisHtml}
            </div>
        `;
        initAnalysisCharts();
    } else {
        resultZone.innerHTML = `
            <div class="bilan-result">
                <div class="bilan-result-header">
                    <span style="font-size: 1.5em;">⚠️</span>
                    <h3 style="color: #f59e0b;">Génération en attente</h3>
                </div>
                <div class="bilan-result-content">
                    <p>${result?.message || 'Le service de génération n\'est pas encore disponible.'}</p>
                </div>
                <div class="bilan-result-actions">
                    <button onclick="renderBilanStep1()" class="bilan-btn-secondary">
                        🔄 Nouveau bilan
                    </button>
                </div>
            </div>
        `;
    }
}

/**
 * Génère et télécharge le fichier Excel rempli
 */
function downloadBilanExcel() {
    const result = bilanData.generatedBilan;
    if (!result) {
        showBilanNotification('Aucun bilan à télécharger.', 'warning');
        return;
    }
    
    try {
        const fileName = result.fileName || `${bilanData.title || 'Bilan'}_${bilanData.date || 'export'}.xlsx`.replace(/[/\\:*?"<>|]/g, '_');
        
        if (result.fileBase64) {
            // Mode delta : le backend retourne le fichier Excel complet en base64
            const bytes = atob(result.fileBase64);
            const buffer = new Uint8Array(bytes.length);
            for (let i = 0; i < bytes.length; i++) {
                buffer[i] = bytes.charCodeAt(i);
            }
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            a.click();
            URL.revokeObjectURL(url);
        } else if (result.sheets) {
            // Fallback ancien mode : reconstruction côté client
            const wb = XLSX.utils.book_new();
            for (const [sheetName, sheetData] of Object.entries(result.sheets)) {
                const ws = XLSX.utils.aoa_to_sheet(sheetData);
                XLSX.utils.book_append_sheet(wb, ws, sheetName);
            }
            XLSX.writeFile(wb, fileName);
        } else {
            showBilanNotification('Aucun bilan à télécharger.', 'warning');
            return;
        }
        
        showBilanNotification(`Fichier "${fileName}" téléchargé.`, 'success');
    } catch (error) {
        showBilanNotification('Erreur lors du téléchargement : ' + error.message, 'error');
    }
}

// ============================================
// COMPOSANTS UI
// ============================================

/**
 * Stepper visuel pour les étapes
 */
function renderStepper(currentStep) {
    const steps = [
        { num: 1, label: 'Campagne' },
        { num: 2, label: 'Statistiques' },
        { num: 3, label: 'Template' },
        { num: 4, label: 'Analyse & Génération' }
    ];
    
    return `
        <div class="bilan-stepper">
            ${steps.map((s, i) => {
                const isActive = s.num === currentStep;
                const isDone = s.num < currentStep;
                const circleClass = isDone ? 'done' : (isActive ? 'active' : 'pending');
                const labelClass = isDone ? 'done' : (isActive ? 'active' : 'pending');
                const lineClass = isDone ? 'done' : 'pending';
                
                return `
                    ${i > 0 ? `<div class="bilan-stepper-line ${lineClass}"></div>` : ''}
                    <div class="bilan-stepper-step">
                        <div class="bilan-stepper-circle ${circleClass}">
                            ${isDone ? '✓' : s.num}
                        </div>
                        <div class="bilan-stepper-label ${labelClass}">${s.label}</div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

/**
 * Notification toast
 */
function showBilanNotification(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `bilan-toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/**
 * Formate une valeur pour l'affichage KPI
 */
function formatBilanValue(key, value) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') {
        if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
        if (value >= 1000) return Math.round(value).toLocaleString('fr-FR');
        return value.toFixed(2);
    }
    return String(value);
}

/**
 * Convertit du markdown basique en HTML pour l'affichage de l'analyse
 */
// Stockage global des configs Chart.js pour initialisation post-DOM
window._pendingCharts = [];

function markdownToHtml(md) {
    if (!md) return '';
    window._pendingCharts = [];
    
    // 1. Extraire les blocs json:table et chartjs AVANT l'échappement HTML
    const jsonTables = [];
    const chartConfigs = [];
    let processed = md.replace(/```json:table\s*\n([\s\S]*?)```/g, (match, jsonStr) => {
        try {
            const data = JSON.parse(jsonStr.trim());
            if (data.headers && data.rows) {
                const idx = jsonTables.length;
                jsonTables.push(data);
                return `%%JSON_TABLE_${idx}%%`;
            }
        } catch (e) {
            console.warn('⚠️ JSON table parse error:', e.message);
        }
        return match;
    });
    processed = processed.replace(/```chartjs\s*\n([\s\S]*?)```/g, (match, jsonStr) => {
        try {
            const config = JSON.parse(jsonStr.trim());
            if (config.type && config.data) {
                const idx = chartConfigs.length;
                chartConfigs.push(config);
                return `%%CHARTJS_${idx}%%`;
            }
        } catch (e) {
            console.warn('⚠️ Chart.js config parse error:', e.message);
        }
        return match;
    });
    
    let html = processed
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/^### (.+)$/gm, '<h5>$1</h5>')
        .replace(/^## (.+)$/gm, '<h4>$1</h4>')
        .replace(/^# (.+)$/gm, '<h3>$1</h3>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
        .replace(/\n{2,}/g, '</p><p>')
        .replace(/\n/g, '<br>');
    // Nettoyer les <ul> multiples
    html = html.replace(/<\/li>\s*<br>\s*<li>/g, '</li><li>');
    // Tables markdown basiques (fallback)
    html = html.replace(/\|(.+)\|<br>\|[-| ]+\|<br>((?:\|.+\|(?:<br>)?)+)/g, (match, header, body) => {
        const ths = header.split('|').filter(s => s.trim()).map(s => `<th>${s.trim()}</th>`).join('');
        const rows = body.replace(/<br>$/,'').split('<br>').map(row => {
            const tds = row.split('|').filter(s => s.trim()).map(s => `<td>${s.trim()}</td>`).join('');
            return `<tr>${tds}</tr>`;
        }).join('');
        return `<table class="bilan-analysis-table"><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`;
    });
    
    // 2. Réinjecter les json:table comme HTML
    html = html.replace(/%%JSON_TABLE_(\d+)%%/g, (match, idx) => {
        const data = jsonTables[parseInt(idx)];
        if (!data) return '';
        const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const ths = data.headers.map(h => `<th>${esc(h)}</th>`).join('');
        const rows = data.rows.map(row => {
            const tds = row.map(cell => `<td>${esc(cell)}</td>`).join('');
            return `<tr>${tds}</tr>`;
        }).join('');
        return `<table class="bilan-analysis-table"><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`;
    });
    
    // 3. Réinjecter les chartjs comme canvas
    html = html.replace(/%%CHARTJS_(\d+)%%/g, (match, idx) => {
        const config = chartConfigs[parseInt(idx)];
        if (!config) return '';
        const canvasId = `bilanChart_${Date.now()}_${idx}`;
        window._pendingCharts.push({ canvasId, config });
        return `<div class="bilan-chart-container"><canvas id="${canvasId}"></canvas><button class="bilan-chart-download" onclick="downloadChartPng('${canvasId}')" title="Télécharger en PNG">📥 Télécharger en PNG</button></div>`;
    });
    
    return `<p>${html}</p>`;
}

/**
 * Initialise les graphiques Chart.js après insertion dans le DOM.
 * Appeler après avoir injecté le HTML retourné par markdownToHtml.
 */
function initAnalysisCharts() {
    if (!window._pendingCharts || window._pendingCharts.length === 0) return;
    
    // Charger Chart.js si pas déjà chargé
    function doInit() {
        for (const { canvasId, config } of window._pendingCharts) {
            const canvas = document.getElementById(canvasId);
            if (!canvas) { console.warn('⚠️ Canvas not found:', canvasId); continue; }
            try {
                // Appliquer des defaults visuels
                if (!config.options) config.options = {};
                if (!config.options.plugins) config.options.plugins = {};
                if (!config.options.plugins.legend) config.options.plugins.legend = {};
                config.options.plugins.legend.labels = { font: { size: 12 }, usePointStyle: true };
                config.options.responsive = true;
                config.options.maintainAspectRatio = true;
                
                new Chart(canvas, config);
            } catch (e) {
                console.warn('⚠️ Chart.js init error:', e.message);
                canvas.parentElement.innerHTML = `<p style="color:#ef4444; font-size:0.85em;">Erreur graphique: ${e.message}</p>`;
            }
        }
        window._pendingCharts = [];
    }
    
    window.downloadChartPng = function(canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const link = document.createElement('a');
        link.download = `graphique_${canvasId}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    };
    
    if (typeof Chart !== 'undefined') {
        doInit();
    } else {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
        script.onload = doInit;
        script.onerror = () => console.warn('⚠️ Impossible de charger Chart.js');
        document.head.appendChild(script);
    }
}

/**
 * Copie l'analyse dans le presse-papier
 */
function exportApiStatsExcel() {
    const views = bilanData._apiViews;
    if (!views) return;
    const wb = XLSX.utils.book_new();
    if (views.global && views.global.rows.length > 0) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([views.global.headers, ...views.global.rows]), 'GLOBAL');
    }
    if (views.formats && views.formats.rows.length > 0) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([views.formats.headers, ...views.formats.rows]), 'FORMATS');
    }
    if (views.ciblages && views.ciblages.rows.length > 0) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([views.ciblages.headers, ...views.ciblages.rows]), 'CIBLAGES');
    }
    if (views.creatives && views.creatives.rows.length > 0) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([views.creatives.headers, ...views.creatives.rows]), 'CREATIVES');
    }
    if (views.codemonocle && views.codemonocle.rows.length > 0) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([views.codemonocle.headers, ...views.codemonocle.rows]), 'CODE MONOCLE');
    }
    if (views.poi && views.poi.rows.length > 0) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([views.poi.headers, ...views.poi.rows]), 'POI');
    }
    if (views.device && views.device.rows.length > 0) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([views.device.headers, ...views.device.rows]), 'DEVICE');
    }
    if (views.os && views.os.rows.length > 0) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([views.os.headers, ...views.os.rows]), 'OS');
    }
    if (views.capping && views.capping.rows.length > 0) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([views.capping.headers, ...views.capping.rows]), 'CAPPING');
    }
    if (views.reach && views.reach.rows.length > 0) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([views.reach.headers, ...views.reach.rows]), 'REACH');
    }
    XLSX.writeFile(wb, `${_exportFileName('Stats_Detaillees')}.xlsx`);
}

function exportApiStatsJson() {
    const data = bilanData._apiRawRecords || [];
    if (data.length === 0) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${_exportFileName('Donnees_Brutes')}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

// ============================================
// EXPORT MENU + FONCTIONS D'EXPORT
// ============================================

/**
 * Génère le HTML du menu d'exports (réutilisable dans step 3 et écran résultat)
 */
function renderExportMenuHtml() {
    if (!bilanData._apiRawHeaders) return '';
    return `
        <div style="position:relative; display:inline-block;">
            <button onclick="toggleExportMenu()" class="bilan-btn-secondary" id="bilanExportMenuBtn" style="display:flex; align-items:center; gap:4px;">
                📥 Exports <span style="font-size:0.7em;">▼</span>
            </button>
            <div id="bilanExportMenu" style="display:none; position:absolute; right:0; bottom:100%; margin-bottom:4px; background:#fff; border:1px solid #e2e8f0; border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,0.12); min-width:240px; z-index:100; overflow:hidden;">
                <div onclick="exportApiStatsExcel(); toggleExportMenu();" style="padding:10px 16px; cursor:pointer; font-size:0.88em; display:flex; align-items:center; gap:8px; border-bottom:1px solid #f1f5f9;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='#fff'">
                    📊 Statistiques (.xlsx)
                </div>
                <div onclick="exportApiStatsJson(); toggleExportMenu();" style="padding:10px 16px; cursor:pointer; font-size:0.88em; display:flex; align-items:center; gap:8px; border-bottom:1px solid #f1f5f9;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='#fff'">
                    📋 Statistiques (.json)
                </div>
                ${bilanData._aggBase64 ? `<div onclick="downloadAggregatedFile(); toggleExportMenu();" style="padding:10px 16px; cursor:pointer; font-size:0.88em; display:flex; align-items:center; gap:8px; border-bottom:1px solid #f1f5f9;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='#fff'">
                    📈 Agrégé (.xlsx)
                </div>` : ''}
                ${bilanData._apiViews?.reach?.rows?.length ? `<div onclick="exportReachData(); toggleExportMenu();" style="padding:10px 16px; cursor:pointer; font-size:0.88em; display:flex; align-items:center; gap:8px; border-bottom:1px solid #f1f5f9;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='#fff'">
                    👥 Reach (.xlsx)
                </div>` : ''}
                ${bilanData._apiViews?.codemonocle?.rows?.length ? `<div onclick="exportCodeMonocle(); toggleExportMenu();" style="padding:10px 16px; cursor:pointer; font-size:0.88em; display:flex; align-items:center; gap:8px; border-bottom:1px solid #f1f5f9;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='#fff'">
                    🔍 Code Monocle (.xlsx)
                </div>` : ''}
                ${bilanData.topDiffPerf ? `<div onclick="exportTopDiffPerf(); toggleExportMenu();" style="padding:10px 16px; cursor:pointer; font-size:0.88em; display:flex; align-items:center; gap:8px; border-bottom:1px solid #f1f5f9;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='#fff'">
                    🏆 Top Diff / Perf (.xlsx)
                </div>` : ''}
                ${bilanData.subdivisions ? `<div onclick="exportSubdivisions(); toggleExportMenu();" style="padding:10px 16px; cursor:pointer; font-size:0.88em; display:flex; align-items:center; gap:8px; border-bottom:1px solid #f1f5f9;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='#fff'">
                    📑 Subdivisions (.txt)
                </div>` : ''}
                <div onclick="exportAllZip(); toggleExportMenu();" style="padding:10px 16px; cursor:pointer; font-size:0.88em; display:flex; align-items:center; gap:8px; background:#f0fdf4; font-weight:600; color:#166534;" onmouseover="this.style.background='#dcfce7'" onmouseout="this.style.background='#f0fdf4'">
                    📦 Tout exporter (.zip)
                </div>
            </div>
        </div>
    `;
}

function toggleExportMenu() {
    const menu = document.getElementById('bilanExportMenu');
    if (!menu) return;
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

// Fermer le menu si clic en dehors
document.addEventListener('click', (e) => {
    const menu = document.getElementById('bilanExportMenu');
    const btn = document.getElementById('bilanExportMenuBtn');
    if (menu && menu.style.display !== 'none' && !menu.contains(e.target) && !btn?.contains(e.target)) {
        menu.style.display = 'none';
    }
});

function _exportFileName(suffix) {
    const hideEnovate = bilanData.selectedTemplatePath && /\b(NRJ|ABR|Carrefour)\b/i.test(bilanData.selectedTemplatePath);
    let campName = (bilanData.apiCampaignName || bilanData.title || 'Campagne')
        .replace(/\[\d+\]/g, '')
        .replace(/[("]*\s*ne pas facturer\s*[)""]*/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    if (hideEnovate) {
        campName = campName
            .replace(/E[- ]?novate\s*[-–—]\s*/gi, '')
            .replace(/\s*[-–—]\s*E[- ]?novate/gi, '')
            .replace(/E[- ]?novate/gi, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }
    const brandPrefix = hideEnovate ? '' : 'E-novate - ';
    const to = bilanData.dateTo || '';
    const now = new Date();
    const todayISO = now.toISOString().split('T')[0];
    const isIntermediaire = to && to > todayISO;
    let base;
    if (isIntermediaire) {
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yyyy = now.getFullYear();
        base = `Bilan Intermediaire - ${brandPrefix}${campName} - ${dd}-${mm}-${yyyy}`;
    } else {
        const endYear = to ? to.split('-')[0] : String(now.getFullYear());
        base = `Bilan Final - ${brandPrefix}${campName} - ${endYear}`;
    }
    base = base.replace(/[/\\:*?"<>|]/g, '_');
    return suffix ? `${base}_${suffix}` : `${base}_`;
}

function exportReachData() {
    const reach = bilanData._apiViews?.reach;
    if (!reach || !reach.rows.length) { showBilanNotification('Aucune donnée Reach', 'warning'); return; }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([reach.headers, ...reach.rows]), 'REACH');
    // Ajouter le total
    if (bilanData.totalReachUsers) {
        const ws = wb.Sheets['REACH'];
        XLSX.utils.sheet_add_aoa(ws, [['', '', '', '', ''], ['TOTAL Unique Users', bilanData.totalReachUsers]], { origin: -1 });
    }
    XLSX.writeFile(wb, `${_exportFileName('reach')}.xlsx`);
}

function exportCodeMonocle() {
    const codemonocle = bilanData._apiViews?.codemonocle;
    if (!codemonocle || !codemonocle.rows.length) { showBilanNotification('Aucune donnée Code Monocle', 'warning'); return; }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([codemonocle.headers, ...codemonocle.rows]), 'CODE MONOCLE');
    XLSX.writeFile(wb, `${_exportFileName('code_monocle')}.xlsx`);
}

function exportTopDiffPerf() {
    const tsv = bilanData.topDiffPerf;
    if (!tsv) { showBilanNotification('Aucune donnée Top Diff/Perf', 'warning'); return; }
    const rows = tsv.split('\n').map(line => line.split('\t'));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'TOP DIFF PERF');
    XLSX.writeFile(wb, `${_exportFileName('top_diff_perf')}.xlsx`);
}

function exportSubdivisions() {
    const text = bilanData.subdivisions;
    if (!text) { showBilanNotification('Aucune donnée Subdivisions', 'warning'); return; }
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${_exportFileName('subdivisions')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
}

async function exportAllZip() {
    showBilanNotification('Préparation du zip...', 'info');
    try {
        const files = [];
        const baseName = _exportFileName('');

        // 1. Stats détaillées xlsx (par jour, format, ciblage, etc.)
        if (bilanData._apiViews) {
            const wb = XLSX.utils.book_new();
            const views = bilanData._apiViews;
            for (const [key, label] of [['global','GLOBAL'],['formats','FORMATS'],['ciblages','CIBLAGES'],['creatives','CREATIVES'],['codemonocle','CODE MONOCLE'],['poi','POI'],['device','DEVICE'],['os','OS'],['capping','CAPPING'],['reach','REACH']]) {
                if (views[key]?.rows?.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([views[key].headers, ...views[key].rows]), label);
            }
            const xlsxData = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            files.push({ name: `${baseName}Stats_Detaillees.xlsx`, data: new Uint8Array(xlsxData) });
        }

        // 2. Données brutes json
        if (bilanData._apiRawRecords?.length) {
            const jsonStr = JSON.stringify(bilanData._apiRawRecords, null, 2);
            files.push({ name: `${baseName}Donnees_Brutes.json`, data: new TextEncoder().encode(jsonStr) });
        }

        // 3. Stats agrégées xlsx (Format × Ciblage)
        if (bilanData._aggBase64) {
            const bin = atob(bilanData._aggBase64);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            files.push({ name: `${baseName}Stats_Agregees.xlsx`, data: arr });
        }

        // 4. Reach xlsx
        if (bilanData._apiViews?.reach?.rows?.length) {
            const wb = XLSX.utils.book_new();
            const reach = bilanData._apiViews.reach;
            const ws = XLSX.utils.aoa_to_sheet([reach.headers, ...reach.rows]);
            if (bilanData.totalReachUsers) XLSX.utils.sheet_add_aoa(ws, [['','','','',''],['TOTAL Unique Users', bilanData.totalReachUsers]], { origin: -1 });
            XLSX.utils.book_append_sheet(wb, ws, 'REACH');
            files.push({ name: `${baseName}Reach.xlsx`, data: new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' })) });
        }

        // 5. Top diff/perf xlsx
        if (bilanData.topDiffPerf) {
            const rows = bilanData.topDiffPerf.split('\n').map(l => l.split('\t'));
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'TOP DIFF PERF');
            files.push({ name: `${baseName}Top_Diff_Perf.xlsx`, data: new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' })) });
        }

        // 6. Subdivisions txt
        if (bilanData.subdivisions) {
            files.push({ name: `${baseName}Subdivisions.txt`, data: new TextEncoder().encode(bilanData.subdivisions) });
        }

        if (files.length === 0) { showBilanNotification('Aucune donnée à exporter', 'warning'); return; }

        // Construire le ZIP manuellement (format minimal sans dépendance)
        const zipBlob = await buildSimpleZip(files);
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${baseName}Export_Complet.zip`;
        a.click();
        URL.revokeObjectURL(url);
        showBilanNotification(`${files.length} fichier(s) exporté(s) dans le zip`, 'success');
    } catch (e) {
        console.error('Erreur export zip:', e);
        showBilanNotification('Erreur export zip: ' + e.message, 'error');
    }
}

/**
 * Construit un fichier ZIP minimal (pas de compression, store only) sans dépendance externe
 */
async function buildSimpleZip(files) {
    const entries = [];
    let offset = 0;

    for (const file of files) {
        const nameBytes = new TextEncoder().encode(file.name);
        const data = file.data;
        const crc = crc32(data);

        // Local file header (30 + name)
        const localHeader = new Uint8Array(30 + nameBytes.length);
        const lv = new DataView(localHeader.buffer);
        lv.setUint32(0, 0x04034b50, true); // signature
        lv.setUint16(4, 20, true); // version needed
        lv.setUint16(6, 0x0800, true); // flags (bit 11 = UTF-8)
        lv.setUint16(8, 0, true); // compression: store
        lv.setUint16(10, 0, true); // mod time
        lv.setUint16(12, 0, true); // mod date
        lv.setUint32(14, crc, true); // crc32
        lv.setUint32(18, data.length, true); // compressed size
        lv.setUint32(22, data.length, true); // uncompressed size
        lv.setUint16(26, nameBytes.length, true); // name length
        lv.setUint16(28, 0, true); // extra length
        localHeader.set(nameBytes, 30);

        entries.push({ nameBytes, data, crc, localHeaderOffset: offset, localHeader });
        offset += localHeader.length + data.length;
    }

    // Central directory
    const cdParts = [];
    let cdSize = 0;
    for (const e of entries) {
        const cd = new Uint8Array(46 + e.nameBytes.length);
        const cv = new DataView(cd.buffer);
        cv.setUint32(0, 0x02014b50, true); // signature
        cv.setUint16(4, 20, true); // version made by
        cv.setUint16(6, 20, true); // version needed
        cv.setUint16(8, 0x0800, true); // flags (bit 11 = UTF-8)
        cv.setUint16(10, 0, true); // compression
        cv.setUint16(12, 0, true); // mod time
        cv.setUint16(14, 0, true); // mod date
        cv.setUint32(16, e.crc, true);
        cv.setUint32(20, e.data.length, true);
        cv.setUint32(24, e.data.length, true);
        cv.setUint16(28, e.nameBytes.length, true);
        cv.setUint16(30, 0, true); // extra length
        cv.setUint16(32, 0, true); // comment length
        cv.setUint16(34, 0, true); // disk start
        cv.setUint16(36, 0, true); // internal attrs
        cv.setUint32(38, 0, true); // external attrs
        cv.setUint32(42, e.localHeaderOffset, true);
        cd.set(e.nameBytes, 46);
        cdParts.push(cd);
        cdSize += cd.length;
    }

    // End of central directory
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    const parts = [];
    for (const e of entries) { parts.push(e.localHeader); parts.push(e.data); }
    for (const cd of cdParts) parts.push(cd);
    parts.push(eocd);

    return new Blob(parts, { type: 'application/zip' });
}

function crc32(data) {
    let crc = 0xFFFFFFFF;
    if (!crc32._table) {
        crc32._table = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            crc32._table[i] = c;
        }
    }
    for (let i = 0; i < data.length; i++) crc = crc32._table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function copyAnalysis() {
    const text = bilanData.analysisResult;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        showBilanNotification('Analyse copiée dans le presse-papier', 'success');
    }).catch(() => {
        showBilanNotification('Erreur lors de la copie', 'error');
    });
}

// ============================================
// RAPPORTS AUTOMATIQUES — UI
// ============================================

let _scheduledReports = [];
let _scheduledTemplatesList = null; // cache des templates bilan

async function renderScheduledReports() {
    const container = document.getElementById('bilanContainer');
    if (!container) return;
    
    container.innerHTML = `<div class="bilan-container"><div style="text-align:center;padding:40px;color:#999;">Chargement...</div></div>`;
    
    try {
        const resp = await fetch('/api/scheduled-reports', { credentials: 'include' });
        if (!resp.ok) throw new Error('Non authentifié ou erreur serveur');
        const data = await resp.json();
        _scheduledReports = data.reports || [];
    } catch (e) {
        container.innerHTML = `<div class="bilan-container"><div style="text-align:center;padding:40px;color:#e74c3c;">❌ ${e.message}</div></div>`;
        return;
    }
    
    const dayNames = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
    const freqLabels = { daily: 'Quotidien', weekly: 'Hebdomadaire', biweekly: 'Bi-hebdo', monthly: 'Mensuel' };
    
    const rows = _scheduledReports.map(r => {
        const statusIcon = !r.last_run_at ? '⏳' : r.last_run_status === 'success' ? '✅' : '❌';
        const lastRun = r.last_run_at ? new Date(r.last_run_at).toLocaleString('fr-FR') : '—';
        const freq = freqLabels[r.frequency] || r.frequency;
        const day = r.frequency === 'weekly' || r.frequency === 'biweekly' ? ` (${dayNames[r.day_of_week || 0]})` : '';
        const dateInfo = r.date_from ? `Depuis ${r.date_from}` : 'Aujourd\'hui';
        const excludeToday = r.exclude_today_stats ? ' 🚫' : '';
        return `
            <tr style="opacity:${r.enabled ? 1 : 0.5}">
                <td><strong>${_esc(r.name)}</strong></td>
                <td>${_esc(r.campaign_ids)}</td>
                <td>${freq}${day} à ${r.hour_of_day || 7}h</td>
                <td style="font-size:0.85em;">${dateInfo}${excludeToday}</td>
                <td>${_esc(r.template_path?.split('/').pop() || r.template_path)}</td>
                <td>${_esc(r.email_to)}</td>
                <td style="font-size:0.85em;">${r.expires_at ? new Date(r.expires_at).toLocaleDateString('fr-FR') : '—'}</td>
                <td>${statusIcon} ${lastRun}${r.last_run_error ? '<br><small style="color:#e74c3c;">' + _esc(r.last_run_error.substring(0,80)) + '</small>' : ''}</td>
                <td style="white-space:nowrap;">
                    <button onclick="toggleScheduledReport(${r.id})" title="${r.enabled ? 'Désactiver' : 'Activer'}" style="background:none;border:none;cursor:pointer;font-size:1.1em;">${r.enabled ? '⏸️' : '▶️'}</button>
                    <button onclick="editScheduledReport(${r.id})" title="Modifier" style="background:none;border:none;cursor:pointer;font-size:1.1em;">✏️</button>
                    <button onclick="runScheduledReport(${r.id})" title="Exécuter maintenant" style="background:none;border:none;cursor:pointer;font-size:1.1em;">🚀</button>
                    <button onclick="deleteScheduledReport(${r.id})" title="Supprimer" style="background:none;border:none;cursor:pointer;font-size:1.1em;">🗑️</button>
                </td>
            </tr>`;
    }).join('');
    
    container.innerHTML = `
        <div class="bilan-container">
            <div class="bilan-header">
                <div class="bilan-header-icon">⏰</div>
                <h2>Rapports automatiques</h2>
                <p>Programmez l'envoi automatique de bilans par email.</p>
                <button onclick="renderBilanStep1(true)" style="margin-top:8px;background:none;border:1px solid rgba(102,126,234,0.3);color:#667eea;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:0.82em;font-family:inherit;">← Retour au bilan</button>
            </div>
            
            <div class="bilan-card">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <h3 style="margin:0;">📋 Rapports programmés (${_scheduledReports.length})</h3>
                    <button onclick="editScheduledReport(null)" class="bilan-btn-primary" style="padding:8px 18px;font-size:0.9em;">+ Nouveau rapport</button>
                </div>
                ${_scheduledReports.length === 0 ? '<p style="text-align:center;color:#999;padding:30px 0;">Aucun rapport programmé. Créez-en un !</p>' : `
                <div style="overflow-x:auto;">
                    <table class="bilan-table" style="font-size:0.85em;">
                        <thead><tr><th>Nom</th><th>Campagne(s)</th><th>Fréquence</th><th>Données</th><th>Template</th><th>Email</th><th>Expire le</th><th>Dernier run</th><th>Actions</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>`}
            </div>
        </div>`;
}

function _esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

async function toggleScheduledReport(id) {
    try {
        await fetch(`/api/scheduled-reports/${id}/toggle`, { method: 'PATCH', credentials: 'include' });
        renderScheduledReports();
    } catch (e) { showBilanNotification('Erreur: ' + e.message, 'error'); }
}

async function deleteScheduledReport(id) {
    if (!confirm('Supprimer ce rapport programmé ?')) return;
    try {
        await fetch(`/api/scheduled-reports/${id}`, { method: 'DELETE', credentials: 'include' });
        showBilanNotification('Rapport supprimé', 'success');
        renderScheduledReports();
    } catch (e) { showBilanNotification('Erreur: ' + e.message, 'error'); }
}

async function runScheduledReport(id) {
    if (!confirm('Exécuter ce rapport maintenant ? Le fichier sera généré et envoyé par email.')) return;
    try {
        const resp = await fetch(`/api/scheduled-reports/${id}/run`, { method: 'POST', credentials: 'include' });
        const data = await resp.json();
        showBilanNotification(`🚀 Exécution lancée : ${data.reportName}. Vérifiez votre email dans quelques minutes.`, 'success');
    } catch (e) { showBilanNotification('Erreur: ' + e.message, 'error'); }
}

async function editScheduledReport(id) {
    const container = document.getElementById('bilanContainer');
    if (!container) return;
    
    // Charger la liste des templates si pas encore fait
    if (!_scheduledTemplatesList) {
        try {
            const resp = await fetch('/api/bilan/templates', { credentials: 'include' });
            const data = await resp.json();
            _scheduledTemplatesList = (data.allFiles || []).map(f => typeof f === 'string' ? f : (f.folderPath ? f.folderPath + '/' + f.name : f.name));
        } catch (e) { _scheduledTemplatesList = []; }
    }
    
    // Charger la config des stat fields
    let statFieldsConfig = bilanData.apiStatFieldsConfig;
    if (!statFieldsConfig) {
        try {
            const resp = await fetch('/templates/bilan/api_statistic_fields.json');
            statFieldsConfig = await resp.json();
        } catch (e) { statFieldsConfig = { categories: [], defaultSelected: [] }; }
    }
    
    const report = id ? _scheduledReports.find(r => r.id === id) : null;
    const isNew = !report;
    
    // Pour un nouveau rapport, pré-sélectionner TOUTES les métriques et utiliser les dates Nova
    const allStatKeys = statFieldsConfig.categories ? statFieldsConfig.categories.flatMap(c => c.fields.map(f => f.key)) : [];
    // Lire les dates depuis bilanData (stockées après fetch Nova)
    const dateFromValue = bilanData.dateFrom || '';
    const campaignIdsValue = bilanData.campaignIds || '';
    console.log('📅 editScheduledReport — bilanData.dateFrom:', bilanData.dateFrom, 'bilanData.dateTo:', bilanData.dateTo, 'campaignIds:', bilanData.campaignIds);
    const v = report || {
        name: '', campaign_ids: campaignIdsValue, template_path: '', 
        statistic_fields: allStatKeys,
        selected_views: ['global','formats','ciblages'],
        frequency: 'weekly', day_of_week: 1, hour_of_day: 7,
        date_range_mode: 'full_period', date_from: dateFromValue, date_to: '',
        want_analysis: false, analysis_type: 'simple',
        subdivisions: bilanData.subdivisions || '', multi_objectifs: bilanData.multiObjectifs || false, detail_ciblage: false,
        email_to: '', email_subject: '', expires_at: ''
    };
    
    const sf = typeof v.statistic_fields === 'string' ? JSON.parse(v.statistic_fields) : (v.statistic_fields || []);
    const sv = typeof v.selected_views === 'string' ? JSON.parse(v.selected_views) : (v.selected_views || []);
    
    // Grouper les templates par dossier pour l'arborescence
    const tplByFolder = {};
    _scheduledTemplatesList.forEach(f => {
        const parts = f.split('/');
        const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '(racine)';
        if (!tplByFolder[folder]) tplByFolder[folder] = [];
        tplByFolder[folder].push(f);
    });
    const sortedFolders = Object.keys(tplByFolder).sort();
    const tplPickerHtml = sortedFolders.map(folder => {
        const files = tplByFolder[folder].map(f => {
            const fileName = f.split('/').pop();
            const selected = f === v.template_path;
            return `<div class="sr-tpl-item${selected ? ' sr-tpl-selected' : ''}" data-path="${_esc(f)}" data-search="${_esc(f.toLowerCase())}" onclick="srSelectTemplate(this)" style="padding:6px 12px 6px 24px;cursor:pointer;font-size:0.85em;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:6px;${selected ? 'background:#eef2ff;font-weight:600;color:#667eea;' : ''}" onmouseover="if(!this.classList.contains('sr-tpl-selected'))this.style.background='#f8fafc'" onmouseout="if(!this.classList.contains('sr-tpl-selected'))this.style.background=''">
                <span style="opacity:0.5;">📄</span> ${_esc(fileName)}
            </div>`;
        }).join('');
        return `<div class="sr-tpl-folder" data-folder="${_esc(folder.toLowerCase())}">
            <div onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none';this.querySelector('.sr-tpl-arrow').textContent=this.nextElementSibling.style.display==='none'?'▶':'▼'" style="padding:8px 12px;cursor:pointer;font-weight:600;font-size:0.88em;color:#374151;background:#f8fafc;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;gap:6px;">
                <span class="sr-tpl-arrow" style="font-size:0.7em;">▶</span> 📁 ${_esc(folder)}
            </div>
            <div style="display:none;">${files}</div>
        </div>`;
    }).join('');
    
    const statFieldChecks = statFieldsConfig.categories.map(cat => {
        const fields = cat.fields.map(f => {
            const checked = sf.includes(f.key) ? 'checked' : '';
            return `<label style="display:inline-flex;align-items:center;gap:4px;margin:2px 8px 2px 0;font-size:0.85em;"><input type="checkbox" name="sr_stat" value="${f.key}" ${checked}> ${_esc(f.label)}</label>`;
        }).join('');
        return `<div style="margin-bottom:6px;"><strong style="font-size:0.8em;color:#667eea;">${_esc(cat.label)}</strong><br>${fields}</div>`;
    }).join('');
    
    const viewChecks = ['global','formats','ciblages','creatives','codemonocle','poi','device','os','capping'].map(vw => {
        const labels = { global:'📅 Par date', formats:'🎨 Formats', ciblages:'🎯 Ciblages', creatives:'🖼️ Créatives', codemonocle:'🔍 Code monocle', poi:'📍 POI', device:'📱 Device', os:'💻 OS', capping:'🎯 Capping Group' };
        return `<label style="display:inline-flex;align-items:center;gap:4px;margin-right:12px;font-size:0.9em;"><input type="checkbox" name="sr_view" value="${vw}" ${sv.includes(vw) ? 'checked' : ''}> ${labels[vw]}</label>`;
    }).join('');
    
    const dayOptions = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'].map((d,i) => `<option value="${i}" ${(v.day_of_week||1)==i?'selected':''}>${d}</option>`).join('');
    const hourOptions = Array.from({length:24},(_, i) => `<option value="${i}" ${(v.hour_of_day??7)==i?'selected':''}>${i}h</option>`).join('');
    
    container.innerHTML = `
        <div class="bilan-container">
            <div class="bilan-header">
                <div class="bilan-header-icon">${isNew ? '➕' : '✏️'}</div>
                <h2>${isNew ? 'Nouveau rapport automatique' : 'Modifier le rapport'}</h2>
                <button onclick="renderScheduledReports()" style="margin-top:8px;background:none;border:1px solid rgba(102,126,234,0.3);color:#667eea;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:0.82em;font-family:inherit;">← Retour à la liste</button>
            </div>
            <div class="bilan-card">
                <div class="bilan-form-group"><label>Nom du rapport *</label><input type="text" id="sr_name" class="bilan-input" value="${_esc(v.name)}" placeholder="Ex: Bilan hebdo NRJ"></div>
                <div class="bilan-form-group"><label>ID Nova (optionnel — pour pré-remplir)</label>
                    <div style="display:flex;gap:8px;align-items:center;">
                        <input type="text" id="sr_nova_id" class="bilan-input" placeholder="Ex: a1b2c" style="flex:1;">
                        <button onclick="srPrefillFromNova()" class="bilan-btn-inline" style="white-space:nowrap;padding:8px 14px;">🌐 Charger infos Nova</button>
                    </div>
                    <div id="sr_nova_status" style="margin-top:4px;"></div>
                    <input type="hidden" id="sr_campaign_end_date" value="${_esc(v.campaign_end_date || '')}">
                </div>
                <div class="bilan-form-group"><label>ID(s) campagne ADX *</label>
                    <input type="text" id="sr_campaign_ids" class="bilan-input" value="${_esc(v.campaign_ids)}" placeholder="Ex: 119145, 119148">
                </div>
                <div class="bilan-form-group"><label>Template Excel *</label>
                    <input type="text" id="sr_tpl_search" class="bilan-input" placeholder="🔍 Rechercher un template..." oninput="srFilterTemplates(this.value)" style="margin-bottom:6px;">
                    <div id="sr_tpl_selected" style="font-size:0.85em;color:#667eea;font-weight:600;margin-bottom:6px;">${v.template_path ? '✅ ' + _esc(v.template_path) : '⚠️ Aucun template sélectionné'}</div>
                    <input type="hidden" id="sr_template" value="${_esc(v.template_path)}">
                    <div id="sr_tpl_list" style="max-height:250px;overflow-y:auto;border:1px solid #e5e7eb;border-radius:8px;">${tplPickerHtml}</div>
                </div>
                <div class="bilan-form-group"><label>Email destinataire *</label><input type="text" id="sr_email" class="bilan-input" value="${_esc(v.email_to)}" placeholder="Ex: client@email.com, equipe@email.com"></div>
                <div class="bilan-form-group"><label>Objet email (optionnel)</label><input type="text" id="sr_subject" class="bilan-input" value="${_esc(v.email_subject || '')}" placeholder="Laissez vide pour un objet automatique"></div>
                <div class="bilan-form-group"><label>Date d'expiration *</label><input type="date" id="sr_expires" class="bilan-input" value="${v.expires_at ? v.expires_at.substring(0,10) : ''}"><div class="bilan-hint">Le rapport sera automatiquement supprimé après cette date.</div></div>
                
                <div class="bilan-form-row">
                    <div class="bilan-form-group" style="flex:1"><label>Fréquence</label>
                        <select id="sr_frequency" class="bilan-input" onchange="document.getElementById('sr_day_row').style.display=this.value==='weekly'||this.value==='biweekly'?'':'none'">
                            <option value="daily" ${v.frequency==='daily'?'selected':''}>Quotidien</option>
                            <option value="weekly" ${v.frequency==='weekly'?'selected':''}>Hebdomadaire</option>
                            <option value="biweekly" ${v.frequency==='biweekly'?'selected':''}>Toutes les 2 semaines</option>
                            <option value="monthly" ${v.frequency==='monthly'?'selected':''}>Mensuel (1er du mois)</option>
                        </select>
                    </div>
                    <div class="bilan-form-group" style="flex:1" id="sr_day_row" ${v.frequency!=='weekly'&&v.frequency!=='biweekly'?'style="display:none"':''}>
                        <label>Jour</label><select id="sr_day" class="bilan-input">${dayOptions}</select>
                    </div>
                    <div class="bilan-form-group" style="flex:1"><label>Heure</label><select id="sr_hour" class="bilan-input">${hourOptions}</select></div>
                </div>
                
                <div class="bilan-form-row">
                    <div class="bilan-form-group" style="flex:1"><label>Date début campagne</label><input type="date" id="sr_date_from" class="bilan-input" value="${v.date_from||''}"></div>
                    <div class="bilan-form-group" style="flex:1"><label>Date fin</label><input type="text" class="bilan-input" value="Aujourd'hui (automatique)" disabled style="background:#f1f5f9;color:#64748b;"></div>
                </div>
                
                <div class="bilan-form-group" style="margin-top:8px;">
                    <label class="bilan-view-check"><input type="checkbox" id="sr_exclude_today" ${v.exclude_today_stats?'checked':''}> 🚫 Exclure les stats du jour</label>
                    <p style="font-size:0.8em;color:#64748b;margin:4px 0 0 24px;">Les données du jour de génération du rapport ne seront pas incluses (par jour, formats, ciblages, etc.)</p>
                </div>
                
                <div class="bilan-form-group"><label>Vues</label><div>${viewChecks}</div></div>
                
                <div class="bilan-form-group" style="margin-top:8px;">
                    <label class="bilan-view-check"><input type="checkbox" id="sr_multi" ${v.multi_objectifs?'checked':''}> 🎯 Multi-objectifs</label>
                    <label class="bilan-view-check"><input type="checkbox" id="sr_detail" ${v.detail_ciblage?'checked':''}> 🔍 Détail ciblage</label>
                </div>
                
                <div class="bilan-form-group"><label>Subdivisions (texte, optionnel)</label><textarea id="sr_subdivisions" class="bilan-input" rows="3" placeholder="Collez le texte de subdivisions ici si nécessaire...">${_esc(v.subdivisions||'')}</textarea></div>
                
                <div class="bilan-form-group"><label>Analyse IA</label>
                    <label class="bilan-view-check"><input type="checkbox" id="sr_analysis" ${v.want_analysis?'checked':''}> Inclure l'analyse Claude</label>
                </div>
                
                <div class="bilan-form-group"><label>Pièces jointes supplémentaires</label>
                    <div style="display:flex;flex-wrap:wrap;gap:8px;">
                        <label class="bilan-view-check"><input type="checkbox" id="sr_attach_stats" ${v.attach_stats?'checked':''}> 📊 Stats détaillées (.xlsx)</label>
                        <label class="bilan-view-check"><input type="checkbox" id="sr_attach_agg" ${v.attach_aggregated?'checked':''}> 📈 Agrégé (.xlsx)</label>
                        <label class="bilan-view-check"><input type="checkbox" id="sr_attach_reach" ${v.attach_reach?'checked':''}> 👥 Reach (.xlsx)</label>
                        <label class="bilan-view-check"><input type="checkbox" id="sr_attach_dashboard" ${v.attach_dashboard?'checked':''}> 🌐 Dashboard (.html)</label>
                    </div>
                </div>
                
                <details style="margin-bottom:16px;" ${isNew ? 'open' : ''}><summary style="cursor:pointer;color:#667eea;font-size:0.9em;">📊 Métriques sélectionnées (${sf.length})</summary><div style="margin-top:8px;max-height:300px;overflow-y:auto;border:1px solid #eee;border-radius:8px;padding:10px;">${statFieldChecks}</div></details>
                
                ${isNew ? '<div class="bilan-form-group" style="margin-bottom:16px;"><label class="bilan-view-check"><input type="checkbox" id="sr_run_test" checked> 🧪 Générer un rapport de test maintenant</label></div>' : ''}
                
                <div style="display:flex;gap:10px;justify-content:flex-end;">
                    <button onclick="renderScheduledReports()" class="bilan-btn-secondary">Annuler</button>
                    <button onclick="saveScheduledReport(${id || 'null'})" class="bilan-btn-primary">${isNew ? 'Créer' : 'Enregistrer'}</button>
                </div>
            </div>
        </div>`;
    
    // Fix day_row visibility
    const freqEl = document.getElementById('sr_frequency');
    if (freqEl) {
        const dayRow = document.getElementById('sr_day_row');
        if (dayRow) dayRow.style.display = (freqEl.value === 'weekly' || freqEl.value === 'biweekly') ? '' : 'none';
    }
    // Auto-open the folder containing the selected template
    const selectedItem = document.querySelector('.sr-tpl-item.sr-tpl-selected');
    if (selectedItem) {
        const folderBody = selectedItem.closest('.sr-tpl-folder')?.querySelector('div:nth-child(2)');
        const arrow = selectedItem.closest('.sr-tpl-folder')?.querySelector('.sr-tpl-arrow');
        if (folderBody) { folderBody.style.display = 'block'; if (arrow) arrow.textContent = '▼'; }
        setTimeout(() => selectedItem.scrollIntoView({ block: 'center', behavior: 'smooth' }), 100);
    }
}

async function srPrefillFromNova() {
    const novaInput = document.getElementById('sr_nova_id');
    const novaId = (novaInput?.value || '').trim();
    if (!novaId) { showBilanNotification('Renseignez d\'abord l\'ID Nova', 'warning'); return; }
    
    const statusDiv = document.getElementById('sr_nova_status');
    if (statusDiv) statusDiv.innerHTML = '<span style="color:#999;font-size:0.85em;">🔄 Chargement...</span>';
    
    try {
        const resp = await fetch('/api/bilan/fetch-nova', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ novaId })
        });
        if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error(err.error || 'Erreur ' + resp.status); }
        const data = await resp.json();
        
        // Pré-remplir les IDs ADX
        const adxInput = document.getElementById('sr_campaign_ids');
        if (adxInput && data.adxId) adxInput.value = data.adxId;
        
        // Pré-remplir le nom du rapport
        const nameInput = document.getElementById('sr_name');
        if (nameInput && !nameInput.value.trim() && data.campaignName) {
            nameInput.value = 'Bilan auto — ' + data.campaignName;
        }
        
        // Pré-remplir les subdivisions
        const subInput = document.getElementById('sr_subdivisions');
        if (subInput && data.subdivisionText) subInput.value = data.subdivisionText;
        
        // Pré-remplir date de début campagne (pour mode "Toute la période")
        const dateFromInput = document.getElementById('sr_date_from');
        if (dateFromInput && data.dateFrom) {
            dateFromInput.value = data.dateFrom;
            console.log('📅 srPrefillFromNova: sr_date_from =', data.dateFrom);
        }
        
        // Pré-remplir date d'expiration avec la date de fin de campagne
        const expiresInput = document.getElementById('sr_expires');
        if (expiresInput && !expiresInput.value && data.dateTo) {
            expiresInput.value = data.dateTo;
        }
        
        // Stocker la date de fin de campagne pour le nommage Final/Intermédiaire
        const endDateInput = document.getElementById('sr_campaign_end_date');
        if (endDateInput && data.dateTo) endDateInput.value = data.dateTo;
        
        // Multi-objectifs
        const multiCheck = document.getElementById('sr_multi');
        if (multiCheck && data.hasMultiObjectifs) multiCheck.checked = true;
        
        // Pré-sélectionner les métriques suggérées par Nova
        if (data.suggestedStatCategories && data.suggestedStatCategories.length > 0) {
            let statFieldsConfig = bilanData.apiStatFieldsConfig;
            if (!statFieldsConfig) {
                try { const r = await fetch('/templates/bilan/api_statistic_fields.json'); statFieldsConfig = await r.json(); } catch(e) {}
            }
            if (statFieldsConfig) {
                const suggestedKeys = new Set();
                for (const catId of data.suggestedStatCategories) {
                    const cat = statFieldsConfig.categories.find(c => c.id === catId);
                    if (cat) cat.fields.forEach(f => suggestedKeys.add(f.key));
                }
                if (suggestedKeys.size > 0) {
                    document.querySelectorAll('input[name="sr_stat"]').forEach(cb => {
                        cb.checked = suggestedKeys.has(cb.value);
                    });
                }
            }
        }
        
        const subCount = data.subdivisionCount || 0;
        const methods = (data.purchasingMethods || []).join(', ');
        if (statusDiv) {
            statusDiv.innerHTML = `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:8px 12px;font-size:0.85em;">
                <strong style="color:#166534;">✅ ${_esc(data.campaignName || 'Campagne')}</strong><br>
                <span style="color:#6c757d;">ADX: ${_esc(data.adxId || '—')} | Dates: ${_esc(data.dateDisplay || '—')} | Mode: ${_esc(methods || '—')}</span><br>
                <span style="color:#6c757d;">Subdivisions: ${subCount} | Annonceur: ${_esc(data.advertiser || '—')}</span>
            </div>`;
        }
        showBilanNotification(`Nova: ${data.campaignName || 'OK'} — ${subCount} subdivision(s)`, 'success');
    } catch (e) {
        if (statusDiv) statusDiv.innerHTML = `<span style="color:#e74c3c;font-size:0.85em;">❌ ${e.message}</span>`;
    }
}

function srSelectTemplate(el) {
    const path = el.getAttribute('data-path');
    // Deselect all
    document.querySelectorAll('.sr-tpl-item').forEach(item => {
        item.classList.remove('sr-tpl-selected');
        item.style.background = '';
        item.style.fontWeight = '';
        item.style.color = '';
    });
    // Select this one
    el.classList.add('sr-tpl-selected');
    el.style.background = '#eef2ff';
    el.style.fontWeight = '600';
    el.style.color = '#667eea';
    // Update hidden input + display
    const hiddenInput = document.getElementById('sr_template');
    if (hiddenInput) hiddenInput.value = path;
    const selectedDiv = document.getElementById('sr_tpl_selected');
    if (selectedDiv) selectedDiv.innerHTML = '✅ ' + path;
}

function srFilterTemplates(query) {
    const q = query.toLowerCase().trim();
    document.querySelectorAll('.sr-tpl-folder').forEach(folder => {
        const items = folder.querySelectorAll('.sr-tpl-item');
        let anyVisible = false;
        items.forEach(item => {
            const searchText = item.getAttribute('data-search') || '';
            const visible = !q || searchText.includes(q);
            item.style.display = visible ? '' : 'none';
            if (visible) anyVisible = true;
        });
        folder.style.display = anyVisible ? '' : 'none';
        // Auto-open folders with matches when searching
        const body = folder.querySelector('div:nth-child(2)');
        const arrow = folder.querySelector('.sr-tpl-arrow');
        if (q && anyVisible && body) { body.style.display = 'block'; if (arrow) arrow.textContent = '▼'; }
    });
}

async function saveScheduledReport(id) {
    const name = document.getElementById('sr_name')?.value?.trim();
    const campaign_ids = document.getElementById('sr_campaign_ids')?.value?.trim();
    const template_path = document.getElementById('sr_template')?.value;
    const email_to = document.getElementById('sr_email')?.value?.trim();
    
    const expires_at = document.getElementById('sr_expires')?.value || null;
    
    if (!name || !campaign_ids || !template_path || !email_to || !expires_at) {
        showBilanNotification('Remplissez les champs obligatoires (nom, campagne, template, email, date d\'expiration)', 'error');
        return;
    }
    
    const statistic_fields = [...document.querySelectorAll('input[name="sr_stat"]:checked')].map(el => el.value);
    const selected_views = [...document.querySelectorAll('input[name="sr_view"]:checked')].map(el => el.value);
    
    const body = {
        name,
        campaign_ids,
        template_path,
        statistic_fields,
        selected_views,
        frequency: document.getElementById('sr_frequency')?.value || 'weekly',
        day_of_week: parseInt(document.getElementById('sr_day')?.value) || 1,
        hour_of_day: parseInt(document.getElementById('sr_hour')?.value) || 7,
        date_from: document.getElementById('sr_date_from')?.value || null,
        exclude_today_stats: document.getElementById('sr_exclude_today')?.checked || false,
        want_analysis: document.getElementById('sr_analysis')?.checked || false,
        analysis_type: 'simple',
        subdivisions: document.getElementById('sr_subdivisions')?.value?.trim() || null,
        multi_objectifs: document.getElementById('sr_multi')?.checked || false,
        detail_ciblage: document.getElementById('sr_detail')?.checked || false,
        email_to,
        email_subject: document.getElementById('sr_subject')?.value?.trim() || null,
        campaign_end_date: document.getElementById('sr_campaign_end_date')?.value || null,
        expires_at,
        attach_stats: document.getElementById('sr_attach_stats')?.checked || false,
        attach_aggregated: document.getElementById('sr_attach_agg')?.checked || false,
        attach_reach: document.getElementById('sr_attach_reach')?.checked || false,
        attach_dashboard: document.getElementById('sr_attach_dashboard')?.checked || false,
        run_test: document.getElementById('sr_run_test')?.checked || false
    };
    
    try {
        const url = id ? `/api/scheduled-reports/${id}` : '/api/scheduled-reports';
        const method = id ? 'PUT' : 'POST';
        const resp = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
        if (!resp.ok) { const e = await resp.json(); throw new Error(e.error || 'Erreur'); }
        const runTest = body.run_test && !id;
        showBilanNotification(id ? 'Rapport modifié ✅' : (runTest ? 'Rapport créé ✅ — test en cours, vérifiez votre email dans quelques minutes.' : 'Rapport créé ✅'), 'success');
        renderScheduledReports();
    } catch (e) {
        showBilanNotification('Erreur: ' + e.message, 'error');
    }
}
