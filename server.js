require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const { Client, GatewayIntentBits, REST, Routes, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const DB_FILE = 'database.json';

let dbData = {
    config: {
        cost: 50,
        rewards: [
            { name: 'เกลือ (อดน้าาา)', chance: 60, isRare: false },
            { name: 'น้ำดื่ม', chance: 25, isRare: false },
            { name: 'โปร 3 แถม 1', chance: 10, isRare: false },
            { name: 'รางวัลใหญ่ SSR', chance: 5, isRare: true }
        ]
    },
    history: []
};

function loadDatabase() {
    if (fs.existsSync(DB_FILE)) {
        try {
            const raw = fs.readFileSync(DB_FILE);
            dbData = JSON.parse(raw);
        } catch (e) {
            console.error(e);
        }
    } else {
        saveDatabase();
    }
}

function saveDatabase() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 4));
    } catch (e) {
        console.error(e);
    }
}

loadDatabase();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages
    ]
});

function parsePointsFromNickname(nickname) {
    if (!nickname) return 0;
    const match = nickname.match(/[Pp]\s*[:：]\s*(\d+)/); 
    return match ? parseInt(match[1]) : 0;
}

function generateNewNickname(originalName, newPoints) {
    if (/[Pp]\s*[:：]\s*\d+/.test(originalName)) {
        return originalName.replace(/([Pp]\s*[:：]\s*)(\d+)/, `$1${newPoints}`);
    } else {
        return `${originalName} P : ${newPoints}`;
    }
}

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    
    const commands = [
        {
            name: 'random',
            description: 'Set Gacha Cost (Admin Only)',
            options: [{ name: 'cost', type: 4, description: 'Points per spin', required: true }]
        },
        {
            name: 'addpoint',
            description: 'Add Points (Admin Only)',
            options: [
                { name: 'user', type: 6, description: 'Target User', required: true },
                { name: 'amount', type: 4, description: 'Amount', required: true }
            ]
        },
        {
            name: 'setreward',
            description: 'Add or Update Reward (Admin Only)',
            options: [
                { name: 'name', type: 3, description: 'Reward Name', required: true },
                { name: 'chance', type: 4, description: 'Chance Weight', required: true },
                { name: 'is_rare', type: 5, description: 'Is Big Win?', required: false }
            ]
        },
        {
            name: 'deletereward',
            description: 'Remove Reward (Admin Only)',
            options: [
                { name: 'name', type: 3, description: 'Reward Name', required: true }
            ]
        },
        {
            name: 'listrewards',
            description: 'Show rewards'
        },
        {
            name: 'history',
            description: 'Show spin history (Last 10)'
        }
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

    try {
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands },
        );
    } catch (error) {
        console.error(error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'listrewards') {
        let msg = "**🎰 Reward List:**\n";
        const totalWeight = dbData.config.rewards.reduce((sum, item) => sum + item.chance, 0);
        dbData.config.rewards.forEach((item, index) => {
            const percent = ((item.chance / totalWeight) * 100).toFixed(1);
            msg += `> \`${index + 1}.\` **${item.name}** ${item.isRare ? '🌟' : ''} (${percent}%)\n`;
        });
        msg += `\n💎 **Cost:** ${dbData.config.cost} P`;
        return interaction.reply(msg);
    }

    if (interaction.commandName === 'history') {
        if (dbData.history.length === 0) return interaction.reply("No history found.");
        const last10 = dbData.history.slice(-10).reverse();
        let msg = "**📜 Recent Spins (Last 10):**\n";
        last10.forEach(log => {
            msg += `• <t:${Math.floor(new Date(log.date).getTime()/1000)}:R> | **${log.user}** ➔ **${log.item}**\n`;
        });
        return interaction.reply(msg);
    }

    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '⛔ Admin only', ephemeral: true });
    }

    if (interaction.commandName === 'random') {
        const cost = interaction.options.getInteger('cost');
        dbData.config.cost = cost; 
        saveDatabase();
        await interaction.reply(`✅ Cost updated to **${cost} Points**`);
    }

    else if (interaction.commandName === 'addpoint') {
        const targetUser = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        await interaction.deferReply();

        try {
            const member = await interaction.guild.members.fetch(targetUser.id);
            const currentName = member.nickname || member.user.username;
            const currentPoints = parsePointsFromNickname(currentName);
            const newPoints = currentPoints + amount;
            const newNickname = generateNewNickname(currentName, newPoints);

            try {
                await member.setNickname(newNickname);
                await interaction.editReply(`✅ Added **${amount} P** to ${targetUser}. (Total: ${newPoints} P)`);
            } catch (nickError) {
                await interaction.editReply(`✅ Added points (${newPoints} P) but **failed to rename**.`);
            }
        } catch (error) {
            console.error(error);
            await interaction.editReply('User not found.');
        }
    }

    else if (interaction.commandName === 'setreward') {
        const name = interaction.options.getString('name');
        const chance = interaction.options.getInteger('chance');
        const isRare = interaction.options.getBoolean('is_rare') || false;
        const index = dbData.config.rewards.findIndex(r => r.name === name);
        
        if (index > -1) {
            dbData.config.rewards[index] = { name, chance, isRare };
            await interaction.reply(`✅ Updated **${name}** (Chance: ${chance}, Rare: ${isRare})`);
        } else {
            dbData.config.rewards.push({ name, chance, isRare });
            await interaction.reply(`✅ Added **${name}** (Chance: ${chance}, Rare: ${isRare})`);
        }
        saveDatabase(); 
    }

    else if (interaction.commandName === 'deletereward') {
        const name = interaction.options.getString('name');
        const initialLength = dbData.config.rewards.length;
        dbData.config.rewards = dbData.config.rewards.filter(r => r.name !== name);
        
        if (dbData.config.rewards.length < initialLength) {
            saveDatabase();
            await interaction.reply(`🗑️ Removed **${name}**`);
        } else {
            await interaction.reply(`❌ Item **${name}** not found`);
        }
    }
});

client.on('guildMemberUpdate', (oldMember, newMember) => {
    const newPoints = parsePointsFromNickname(newMember.nickname || newMember.user.username);
    io.to(newMember.id).emit('pointUpdate', newPoints);
});

client.login(process.env.BOT_TOKEN);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set('trust proxy', 1);

const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 1000 * 60 * 60 * 24
    }
});

app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());
app.set('view engine', 'ejs');
app.use(express.static('public'));

const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);
io.use(wrap(sessionMiddleware));
io.use(wrap(passport.initialize()));
io.use(wrap(passport.session()));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL,
    scope: ['identify']
}, (accessToken, refreshToken, profile, done) => {
    return done(null, profile);
}));

io.on('connection', async (socket) => {
    const user = socket.request.user;
    if (user) {
        socket.join(user.id);
        try {
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const member = await guild.members.fetch(user.id);
            const points = parsePointsFromNickname(member.nickname || member.user.username);
            socket.emit('pointUpdate', points);
        } catch (e) { console.error(e); }
    }
});

app.get('/', (req, res) => res.render('index', { user: req.user }));
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
app.get('/logout', (req, res, next) => req.logout(err => res.redirect('/')));

app.post('/api/spin', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ msg: "Login required" });

    const userId = req.user.id;
    const guildId = process.env.GUILD_ID;
    const COST = dbData.config.cost;

    try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        
        const currentName = member.nickname || member.user.username;
        const currentPoints = parsePointsFromNickname(currentName);

        if (currentPoints < COST) {
            return res.json({ success: false, msg: `Not enough points! Need ${COST} P` });
        }

        const newPoints = currentPoints - COST;
        const newNickname = generateNewNickname(currentName, newPoints);

        try {
            await member.setNickname(newNickname);
        } catch (nickError) {
            console.error("Nickname failed:", nickError.message);
            return res.json({ success: false, msg: "Bot cannot change nickname (Permission/Owner)" });
        }

        const rewardPool = dbData.config.rewards;
        let totalWeight = rewardPool.reduce((sum, item) => sum + item.chance, 0);
        let randomNum = Math.random() * totalWeight;
        let rewardItem = null;

        for (const item of rewardPool) {
            if (randomNum < item.chance) {
                rewardItem = item;
                break;
            }
            randomNum -= item.chance;
        }

        if (!rewardItem) rewardItem = rewardPool[0];

        dbData.history.push({
            user: req.user.username,
            userId: userId,
            item: rewardItem.name,
            cost: COST,
            date: new Date().toISOString()
        });
        saveDatabase();

        if (rewardItem.isRare) {
            const avatarUrl = req.user.avatar ? `https://cdn.discordapp.com/avatars/${userId}/${req.user.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png';
            io.emit('jackpot', {
                winner: req.user.username,
                item: rewardItem.name,
                avatar: avatarUrl
            });
        }

        if (process.env.LOG_CHANNEL_ID) {
            try {
                const logChannel = await client.channels.fetch(process.env.LOG_CHANNEL_ID);
                if (logChannel) {
                    const avatarUrl = req.user.avatar 
                        ? `https://cdn.discordapp.com/avatars/${userId}/${req.user.avatar}.png` 
                        : 'https://cdn.discordapp.com/embed/avatars/0.png';

                    const logEmbed = new EmbedBuilder()
                        .setColor(rewardItem.isRare ? 0xFFD700 : 0xFF9EB5)
                        .setAuthor({ name: `${req.user.username} Spin!`, iconURL: avatarUrl })
                        .setTitle(rewardItem.isRare ? '🏆 JACKPOT!' : '🎉 Reward Received!')
                        .setDescription(`> **${rewardItem.name}**`) 
                        .addFields(
                            { name: '💎 Reward', value: `# 🎁 ${rewardItem.name}`, inline: false },
                            { name: '👤 User', value: `<@${userId}>`, inline: true },
                            { name: '💰 Balance', value: `\`${newPoints} P\``, inline: true }
                        )
                        .setThumbnail(avatarUrl)
                        .setFooter({ text: 'Pianissimo Gacha', iconURL: client.user.displayAvatarURL() })
                        .setTimestamp();

                    await logChannel.send({ embeds: [logEmbed] });
                }
            } catch (err) {
                console.error("Failed to send log:", err);
            }
        }

        console.log(`[Spin] Result: ${rewardItem.name}`);
        res.json({ success: true, item: rewardItem.name, points: newPoints, isRare: rewardItem.isRare });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, msg: "Server Error" });
    }
});

server.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});
