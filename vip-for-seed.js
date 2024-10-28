import BasePlugin from './base-plugin.js';
import axios from 'axios';
import { subtle } from 'node:crypto';

export default class VipForSeed extends BasePlugin {
  static get description() {
    return 'The <code>FogOfWar</code> plugin can be used to automate setting fog of war mode.';
  }

  static get defaultEnabled() {
    return false;
  }

  static get optionsSpecification() {
    return {
      vip_webhook: {
        required: true,
        description: 'Squad-Admin-Configurator webhook uri',
        default: ''
      },
      hmac_key: {
        required: true,
        description: 'Squad-Admin-Configurator webhook hmac key',
        default: ''
      },
      hmac_hash_function: {
        required: false,
        description: 'Squad-Admin-Configurator webhook hmac hash',
        default: 'SHA-256'
      },
      number_first_players_for_vip: {
        required: false,
        description: 'The number of the first players to be issued a VIP later',
        default: 30
      },
      number_players_in_server_for_vip: {
        required: false,
        descriprion: 'The number of users on the server at which VIP is issued',
        default: 40
      },
      delay_before_show_message_on_connect: {
        required: false,
        description: 'The delay before showing the message to the user when it is connected',
        default: 10
      }
    };
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);

    this.encoder = new TextEncoder();
    this.key = null;

    this.seedPlayersIDs = [];
    this.ignorePlayersIDs = [];
    this.updatePlayersSteamIDs = this.updatePlayersSteamIDs.bind(this);
    this.grantingVipToPlayers = this.grantingVipToPlayers.bind(this);
    this.restartPlugin = this.restartPlugin.bind(this);
    this.importKey = this.importKey.bind(this);
    this.warn = this.warn.bind(this);
    this.isVipGrantedInThisGame = false;
  }

  async mount() {
    await this.importKey();

    this.server.on('PLAYER_CONNECTED', async (data) => {
      if (!this.server.currentLayer) {
        return;
      }

      if (this.server.currentLayer.gamemode === 'Seed' && !this.isVipGrantedInThisGame) {
        if (this.server.players.length <= this.options.number_first_players_for_vip) {
          this.updatePlayersSteamIDs();
          setTimeout(() => {
            this.warn(
              data.player.steamID,
              `Вы получите VIP на 2 дня когда на сервере будет ${this.options.number_players_in_server_for_vip} игроков. Спасибо за помощь в поднятии сервера!`,
              3
            );
          }, this.options.delay_before_show_message_on_connect * 1000);
          this.verbose(1, 'Обновлен список игроков');
        } else if (this.server.players.length >= this.options.number_players_in_server_for_vip) {
          this.isVipGrantedInThisGame = true;
          await this.grantingVipToPlayers();
          this.addPlayersToIgnore();
          this.verbose(1, 'Выданы роли');
        }
      }
    });
    this.server.on('NEW_GAME', this.restartPlugin);
  }

  async grantingVipToPlayers() {
    for (const index in this.seedPlayersIDs) {
      const steamID = this.seedPlayersIDs[index];
      const player = await this.server.getPlayerBySteamID(steamID);

      if (!player) {
        continue;
      }

      let data = JSON.stringify({
        steam_id: `${steamID}`,
        name: player.name,
        comment: 'Seed for vip from SquadJS plugin'
      });

      try {
        await axios.post(this.options.vip_webhook, data, {
          headers: {
            'Content-Type': 'application/json',
            'X-SIGNATURE': Buffer.from(
              await subtle.sign('HMAC', this.key, this.encoder.encode(data))
            ).toString('hex')
          }
        });
      } catch (error) {
        this.verbose(1, `Response error ${error}, on user ${steamID}`);
      }

      await this.warn(steamID, 'Спасибо за поднятие сервера, вам выдан вип на 2 дня', 3);
    }
  }

  async importKey() {
    this.key = await subtle.importKey(
      'raw',
      this.encoder.encode(this.options.hmac_key),
      { name: 'HMAC', hash: this.options.hmac_hash_function },
      false,
      ['sign']
    );
  }

  updatePlayersSteamIDs() {
    this.seedPlayersIDs = this.server.players.map((player) => player.steamID);
  }

  addPlayersToIgnore() {
    this.ignorePlayersIDs = this.ignorePlayersIDs.concat(this.seedPlayersIDs);
  }

  async warn(playerID, message, repeat = 1, frequency = 5) {
    for (let i = 0; i < repeat; i++) {
      // repeat используется для того, чтобы squad выводил все сообщения, а не скрывал их из-за того, что они одинаковые
      await this.server.rcon.warn(playerID, message + '\u{00A0}'.repeat(i));

      if (i !== repeat - 1) {
        await new Promise((resolve) => setTimeout(resolve, frequency * 1000));
      }
    }
  }

  restartPlugin() {
    this.seedPlayersIDs = [];
    this.isVipGrantedInThisGame = false;
  }
}
