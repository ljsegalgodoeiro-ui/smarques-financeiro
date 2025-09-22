// sync.js - Sistema de Sincronização SMarques
class SMarquesSync {
    constructor(config) {
        this.config = {
            owner: config.owner || 'seu-usuario', // ALTERE AQUI!
            repo: config.repo || 'smarques-financeiro',
            branch: config.branch || 'main',
            token: config.token || null, // Token para escrita (opcional)
            dataFile: 'data/gastos.json'
        };
        
        this.baseUrl = `https://api.github.com/repos/${this.config.owner}/${this.config.repo}`;
        this.rawUrl = `https://raw.githubusercontent.com/${this.config.owner}/${this.config.repo}/${this.config.branch}`;
        
        this.cache = {
            receitas: JSON.parse(localStorage.getItem('receitasSMarques') || '[]'),
            despesas: JSON.parse(localStorage.getItem('despesasSMarques') || '[]'),
            orcamentos: JSON.parse(localStorage.getItem('orcamentosSMarques') || '{}'),
            saldosAnteriores: JSON.parse(localStorage.getItem('saldosAnteriores') || '{}'),
            gastosRapidos: JSON.parse(localStorage.getItem('gastosSMarques') || '[]'),
            lastSync: localStorage.getItem('lastSync') || '0'
        };
        
        this.syncStatus = 'offline';
        this.callbacks = [];
    }

    // Adicionar callback para mudanças de status
    onStatusChange(callback) {
        this.callbacks.push(callback);
    }

    // Notificar mudanças de status
    notifyStatusChange(status, message = '') {
        this.syncStatus = status;
        this.callbacks.forEach(callback => callback(status, message));
    }

    // Carregar dados do GitHub
    async carregarDados() {
        try {
            this.notifyStatusChange('syncing', 'Carregando dados...');
            
            const response = await fetch(`${this.rawUrl}/${this.config.dataFile}`);
            
            if (response.ok) {
                const dados = await response.json();
                
                // Atualizar cache local
                this.cache = {
                    ...this.cache,
                    ...dados,
                    lastSync: new Date().toISOString()
                };
                
                // Salvar no localStorage
                this.salvarCache();
                
                this.notifyStatusChange('connected', 'Dados carregados');
                return dados;
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            console.log('Erro ao carregar dados:', error);
            this.notifyStatusChange('offline', 'Usando dados locais');
            return this.cache;
        }
    }

    // Salvar dados no GitHub (requer token)
    async salvarDados(dados) {
        if (!this.config.token) {
            console.log('Token não configurado - salvando apenas localmente');
            this.cache = { ...this.cache, ...dados };
            this.salvarCache();
            return true;
        }

        try {
            this.notifyStatusChange('syncing', 'Salvando dados...');
            
            // Obter SHA atual do arquivo
            const fileResponse = await fetch(`${this.baseUrl}/contents/${this.config.dataFile}`, {
                headers: {
                    'Authorization': `token ${this.config.token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            let sha = null;
            if (fileResponse.ok) {
                const fileData = await fileResponse.json();
                sha = fileData.sha;
            }

            // Preparar dados para salvar
            const dadosCompletos = {
                ...this.cache,
                ...dados,
                lastUpdate: new Date().toISOString()
            };

            // Salvar no GitHub
            const saveResponse = await fetch(`${this.baseUrl}/contents/${this.config.dataFile}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${this.config.token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: `Atualização automática - ${new Date().toLocaleString('pt-BR')}`,
                    content: btoa(unescape(encodeURIComponent(JSON.stringify(dadosCompletos, null, 2)))),
                    sha: sha,
                    branch: this.config.branch
                })
            });

            if (saveResponse.ok) {
                this.cache = dadosCompletos;
                this.salvarCache();
                this.notifyStatusChange('connected', 'Dados salvos');
                return true;
            } else {
                throw new Error(`Erro ao salvar: ${saveResponse.status}`);
            }
        } catch (error) {
            console.log('Erro ao salvar no GitHub:', error);
            // Salvar localmente mesmo se GitHub falhar
            this.cache = { ...this.cache, ...dados };
            this.salvarCache();
            this.notifyStatusChange('error', 'Erro ao sincronizar');
            return false;
        }
    }

    // Salvar cache local
    salvarCache() {
        localStorage.setItem('receitasSMarques', JSON.stringify(this.cache.receitas));
        localStorage.setItem('despesasSMarques', JSON.stringify(this.cache.despesas));
        localStorage.setItem('orcamentosSMarques', JSON.stringify(this.cache.orcamentos));
        localStorage.setItem('saldosAnteriores', JSON.stringify(this.cache.saldosAnteriores));
        localStorage.setItem('gastosSMarques', JSON.stringify(this.cache.gastosRapidos));
        localStorage.setItem('lastSync', this.cache.lastSync);
    }

    // Adicionar receita
    async adicionarReceita(receita) {
        receita.id = receita.id || Date.now();
        receita.timestamp = new Date().toISOString();
        
        this.cache.receitas.push(receita);
        return await this.salvarDados({ receitas: this.cache.receitas });
    }

    // Adicionar despesa
    async adicionarDespesa(despesa) {
        despesa.id = despesa.id || Date.now();
        despesa.timestamp = new Date().toISOString();
        
        this.cache.despesas.push(despesa);
        return await this.salvarDados({ despesas: this.cache.despesas });
    }

    // Adicionar gasto rápido (do mobile)
    async adicionarGastoRapido(gasto) {
        // Converter gasto rápido para formato de despesa
        const despesa = {
            id: gasto.id || Date.now(),
            descricao: gasto.descricao,
            valor: gasto.valor,
            categoria: gasto.categoria,
            dataVencimento: gasto.data,
            dataPagamento: gasto.data,
            pago: true,
            mes: new Date(gasto.data).getMonth(),
            ano: new Date(gasto.data).getFullYear(),
            timestamp: gasto.timestamp || new Date().toISOString(),
            origem: 'mobile'
        };

        // Adicionar ao cache de gastos rápidos
        this.cache.gastosRapidos.unshift(gasto);
        
        // Manter apenas últimos 100 gastos rápidos
        if (this.cache.gastosRapidos.length > 100) {
            this.cache.gastosRapidos = this.cache.gastosRapidos.slice(0, 100);
        }

        // Adicionar às despesas principais
        this.cache.despesas.push(despesa);

        // Salvar tudo
        return await this.salvarDados({
            despesas: this.cache.despesas,
            gastosRapidos: this.cache.gastosRapidos
        });
    }

    // Remover item
    async removerItem(tipo, id) {
        if (this.cache[tipo]) {
            this.cache[tipo] = this.cache[tipo].filter(item => item.id !== id);
            return await this.salvarDados({ [tipo]: this.cache[tipo] });
        }
        return false;
    }

    // Atualizar item
    async atualizarItem(tipo, id, dadosAtualizados) {
        if (this.cache[tipo]) {
            const index = this.cache[tipo].findIndex(item => item.id === id);
            if (index !== -1) {
                this.cache[tipo][index] = { ...this.cache[tipo][index], ...dadosAtualizados };
                return await this.salvarDados({ [tipo]: this.cache[tipo] });
            }
        }
        return false;
    }

    // Sincronização automática
    iniciarSincronizacaoAutomatica(intervalo = 30000) { // 30 segundos
        setInterval(async () => {
            if (this.syncStatus !== 'syncing') {
                await this.carregarDados();
            }
        }, intervalo);

        // Sincronizar quando a página voltar ao foco
        window.addEventListener('focus', () => {
            if (this.syncStatus !== 'syncing') {
                this.carregarDados();
            }
        });

        // Salvar antes de sair
        window.addEventListener('beforeunload', () => {
            this.salvarCache();
        });
    }

    // Obter dados atuais
    obtenerDados() {
        return this.cache;
    }

    // Verificar conectividade
    async verificarConectividade() {
        try {
            const response = await fetch(`${this.rawUrl}/${this.config.dataFile}`, {
                method: 'HEAD',
                cache: 'no-cache'
            });
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    // Exportar dados para backup
    exportarBackup() {
        const backup = {
            ...this.cache,
            backupDate: new Date().toISOString(),
            version: '1.0'
        };
        
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `smarques-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        
        URL.revokeObjectURL(url);
    }

    // Importar dados de backup
    async importarBackup(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = async (e) => {
                try {
                    const backup = JSON.parse(e.target.result);
                    
                    // Validar estrutura básica
                    if (!backup.receitas || !backup.despesas) {
                        throw new Error('Arquivo de backup inválido');
                    }
                    
                    // Restaurar dados
                    this.cache = {
                        receitas: backup.receitas || [],
                        despesas: backup.despesas || [],
                        orcamentos: backup.orcamentos || {},
                        saldosAnteriores: backup.saldosAnteriores || {},
                        gastosRapidos: backup.gastosRapidos || [],
                        lastSync: new Date().toISOString()
                    };
                    
                    // Salvar tudo
                    await this.salvarDados(this.cache);
                    
                    resolve(true);
                } catch (error) {
                    reject(error);
                }
            };
            
            reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
            reader.readAsText(file);
        });
    }
}

// Configuração global para facilitar o uso
window.SMarquesSync = SMarquesSync;

// Instância global (será configurada pelos apps)
window.syncManager = null;

// Função para inicializar o sync
window.initSMarquesSync = function(config = {}) {
    const defaultConfig = {
        owner: 'seu-usuario', // ALTERE AQUI
        repo: 'smarques-financeiro',
        branch: 'main'
    };
    
    window.syncManager = new SMarquesSync({ ...defaultConfig, ...config });
    return window.syncManager;
};
