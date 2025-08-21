import { addIcon, App, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';

interface ObsidibaggerSettings {
	// user-visible settings:
	noteFolder: string;
	instanceUrl: string;
	clientId: string;
	clientSecret: string;
	username: string;
	password: string;
	onlyStarred: boolean; // whether to only sync starred articles
	// hidden settings:
	accessToken: string;
	refreshToken: string;
	tokenExpiry: number; // Unix timestamp
	since: number; // Unix timestamp of last sync
}

const DEFAULT_SETTINGS: Partial<ObsidibaggerSettings> = {
	instanceUrl: 'https://app.wallabag.it',
	noteFolder: 'Wallabag',
	onlyStarred: true,
	since: 0, // default to 0 for no articles synced
}

export default class ObsidibaggerPlugin extends Plugin {
	settings: ObsidibaggerSettings;

	async onload() {
		await this.loadSettings();

		// Load Wallabag icon (SVG)
		addIcon('wallabag', `<path d="m 11.414,46.71 c -0.315,-0.858 -0.424,-2.654 -0.243,-3.99 0.274,-2.016 0.93,-2.432 3.83,-2.432 3.333,0 3.5,0.175 3.5,3.663 0,3.37 -0.26,3.69 -3.257,3.992 -2.184,0.22 -3.445,-0.186 -3.83,-1.232 m 20,0 c -0.314,-0.858 -0.423,-2.654 -0.242,-3.99 0.274,-2.016 0.93,-2.432 3.83,-2.432 3.333,0 3.5,0.175 3.5,3.663 0,3.37 -0.26,3.69 -3.257,3.992 -2.184,0.22 -3.445,-0.186 -3.83,-1.232 M 5.24,35.84 C 2.195,32.954 0.9,31.105 0.362,26.45 0.065,23.865 0,20.42 0,15.45 0,11.532 0.044,8.59 0.203,6.386 0.597,0.92 1.697,0 4.578,0 7.054,0 8.105,0.982 8.68,5.802 c 0.24,1.995 0.396,4.647 0.54,8.16 0.148,3.654 0.3,6.308 0.567,8.232 0.608,4.363 1.813,4.975 4.928,4.998 2.317,0.016 3.477,-1.445 3.973,-6.016 0.223,-2.05 0.312,-4.725 0.312,-8.173 0,-3.606 0.097,-6.24 0.398,-8.15 0.605,-3.84 2.033,-4.77 5.152,-4.82 2.533,-0.04 3.684,0.91 4.158,4.78 0.217,1.776 0.292,4.168 0.292,7.362 0,3.863 0.088,6.793 0.334,8.987 0.555,4.96 1.915,6.153 4.876,5.85 2.813,-0.287 3.923,-1.255 4.38,-6.276 0.193,-2.115 0.27,-4.95 0.31,-8.754 0.034,-3.17 0.136,-5.536 0.38,-7.29 C 39.802,0.947 40.972,0 43.5,0 c 2.822,0 3.908,0.95 4.298,6.424 0.157,2.2 0.202,5.132 0.202,9.028 0,4.967 -0.065,8.414 -0.363,10.997 -0.537,4.654 -1.833,6.503 -4.876,9.39 -2.516,2.39 -3.944,2.88 -8.405,2.88 -4.137,0 -5.77,-0.483 -7.087,-2.094 -0.942,-1.15 -2.412,-2.093 -3.268,-2.093 -0.856,0 -2.326,0.942 -3.268,2.093 -1.318,1.61 -2.95,2.093 -7.087,2.093 -4.46,0 -5.89,-0.49 -8.406,-2.88" fill="currentColor"/>`);

		// Create a little icon on the left ribbon.
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const ribbonIconEl = this.addRibbonIcon('wallabag', 'Greet', () => {
			this.syncWallabagArticles();
		});

		this.addCommand({
			id: 'sync-wallabag-articles',
			name: 'Sync Wallabag articles',
			callback: () => this.syncWallabagArticles()
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new ObsidibaggerSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async authenticate(): Promise<void> {
		const { instanceUrl, clientId, clientSecret, username, password } = this.settings;
		if (!instanceUrl || !clientId || !clientSecret || !username || !password) {
			new Notice('Obsidibagger: Please fill in all Wallabag credentials in the settings.');
			throw new Error('Missing credentials');
		}
		new Notice('Obsidibagger: Authenticating with Wallabag...');
		const url = `${instanceUrl}/oauth/v2/token`;
		const body = new URLSearchParams({
			grant_type: 'password',
			client_id: clientId,
			client_secret: clientSecret,
			username,
			password
		});
		const resp = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body
		});
		if (!resp.ok) {
			new Notice('Obsidibagger: Failed to authenticate with Wallabag.');
			throw new Error(await resp.text());
		}
		const data = await resp.json();
		this.settings.accessToken = data.access_token;
		this.settings.refreshToken = data.refresh_token;
		this.settings.tokenExpiry = Date.now() + (data.expires_in * 1000);
		await this.saveSettings();
	}

	async ensureTokenValid(): Promise<void> {
		if (!this.settings.accessToken || Date.now() > this.settings.tokenExpiry - 60 * 1000) {
			await this.authenticate();
		}
	}

	async syncWallabagArticles() {
		try {
			await this.ensureTokenValid();
			const articles = await this.fetchArticles();

			const folderPath = this.settings.noteFolder || 'Wallabag';
			await this.ensureFolderExists(folderPath);

			for (const article of articles) {
				await this.createOrUpdateArticleNote(article, folderPath);
			}
			new Notice(`Obsidibagger: Synced ${articles.length} Wallabag articles.`);
		} catch (e) {
			console.error(e);
			new Notice('Obsidibagger: Sync failed. See console for details.');
		}
	}

	async fetchArticles(): Promise<unknown[]> {
		const { instanceUrl, accessToken, since } = this.settings;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any, prefer-const
		let articles: any[] = [];
		let page = 1;
		let hasMore = true;
		const newSince = Date.now() / 1000;

		new Notice('Obsidibagger: Fetching Wallabag articles...');
		while (hasMore) {
			let wbURL = `${instanceUrl}/api/entries.json?since=${since}&page=${page}&perPage=30`
			if (this.settings.onlyStarred) { wbURL += '&starred=1'; }
			const resp = await fetch(wbURL, {
				headers: { Authorization: `Bearer ${accessToken}` }
			});
			if (!resp.ok) throw new Error(`Failed to fetch articles: ${await resp.text()}`);
			const data = await resp.json();
			articles.push(...(data._embedded?.items || []));
			if (data._links?.next) page++;
			else hasMore = false;
		}
		this.settings.since = newSince;
		await this.saveSettings();
		return articles;
	}

	async createOrUpdateArticleNote(article: any, folder: string) {
		const vault = this.app.vault;
		const sanitizedTitle = article.title.replace(/[\\/:*?"<>|]/g, '-');
		const fileName = `${sanitizedTitle}.md`;
		const filePath = `${folder}/${fileName}`;
		const noteContent = this.articleToMarkdown(article);

		const existing = vault.getAbstractFileByPath(filePath);
		if (existing instanceof TFile) {
			await vault.modify(existing, noteContent);
		} else {
			await vault.create(filePath, noteContent);
		}
	}

	articleToMarkdown(article: any): string {
		return `---
url: ${article.url}
tags: ${(article.tags || []).map((t: any) => t.label.replace(' ', '-')).join(', ')}
created_at: ${article.created_at}
wallabag id: ${article.id}
---

# ${article.title}

${article.content ? this.htmlToMarkdown(article.content) : ''}
`;
	}

	// Basic HTML to Markdown; for full fidelity, consider using Turndown or another HTML-to-MD converter.
	htmlToMarkdown(html: string): string {
		return html
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/?[^>]+(>|$)/g, '') // strip tags
			.replace(/&nbsp;/g, ' ')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.trim();
	}

	async ensureFolderExists(folder: string) {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(folder))) {
			await adapter.mkdir(folder);
		}
	}

}

class ObsidibaggerSettingTab extends PluginSettingTab {
	plugin: ObsidibaggerPlugin;

	constructor(app: App, plugin: ObsidibaggerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Folder for Wallabag notes')
			.setDesc('Synced articles will appear as notes here.')
			.addText(text => text
				.setValue(this.plugin.settings.noteFolder || 'Wallabag')
				.onChange(async (value) => {
					this.plugin.settings.noteFolder = value.trim() || 'Wallabag';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Only sync starred articles')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.onlyStarred)
				.onChange(async (value) => {
					this.plugin.settings.onlyStarred = value;
					await this.plugin.saveSettings();
					this.display();
				})
			);
		
		containerEl.createEl('h2', { text: 'Wallabag Server' });
		containerEl.createEl('span', { text: 'Create a new Client in your ' });
		containerEl.createEl('a', { href: "https://app.wallabag.it/developer", text: "Wallabag account settings"});
		containerEl.createEl('span', { text: '.' });

		new Setting(containerEl)
			.setName('Wallabag server URL')
			.setDesc('Where is your Wallabag instance?')
			.addText(text => text
				.setPlaceholder('Enter URL')
				.setValue(this.plugin.settings.instanceUrl)
				.onChange(async (value) => {
					this.plugin.settings.instanceUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('OAuth Client ID')
			.setDesc('Your Wallabag OAuth client ID')
			.addText(text => text
				.setValue(this.plugin.settings.clientId || '')
				.onChange(async (value) => {
					this.plugin.settings.clientId = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('OAuth Client Secret')
			.setDesc('Your Wallabag OAuth client secret')
			.addText(text => text
				.setPlaceholder('Enter OAuth client secret')
				.setValue(this.plugin.settings.clientSecret || '')
				.onChange(async (value) => {
					this.plugin.settings.clientSecret = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Wallabag Username')
			.setDesc('Your Wallabag username')
			.addText(text => text
				.setValue(this.plugin.settings.username || '')
				.onChange(async (value) => {
					this.plugin.settings.username = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Wallabag Password')
			.setDesc('Your Wallabag password (stored locally)')
			.addText(text => text
				.setValue(this.plugin.settings.password || '')
				.onChange(async (value) => {
					this.plugin.settings.password = value.trim();
					await this.plugin.saveSettings();
					}));

		containerEl.createEl('h2', { text: 'Danger Zone', cls: 'danger' });

		new Setting(containerEl)
			.setName('Reset sync memory')
			.setClass('danger')
			.setDesc('This will reset the last sync timestamp and force a full resync of all articles.')
			.addButton(resetSyncButton => resetSyncButton
			// .setIcon('refresh-cw-off')
			.setButtonText('Reset sync')
			.onClick(async () => {
				this.plugin.settings.since = 0;
				await this.plugin.saveSettings();
				new Notice('Sync memory reset.');
			}))

	}
}
