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
            { name: 'เกลือ (อดน้าาา)', chance: 60 },
            { name: 'น้ำดื่ม', chance: 25 },
            { name: 'โปร 3 แถม 1', chance: 10 },
            { name: 'รางวัลใหญ่ SSR', chance: 5 }
        ]
    },
    history: []
};

function loadDatabase() {
    if (fs.existsSync(DB_FILE)) {
        try {
            const raw = fs.readFileSync(DB_FILE);
            dbData = JSON.parse(raw);
            console.log('📂 Database loaded successfully.');
        } catch (e) {
            console.error('Error loading database, using default.');
        }
    } else {
        saveDatabase();
    }
}

function saveDatabase() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 4));
    } catch (e) {
        console.error('Error saving database:', e);
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
                { name: 'chance', type: 4, description: 'Chance Weight', required: true }
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
        console.log('Slash Commands Registered.');
    } catch (error) {
        console.error(error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'listrewards') {
        let msg = "**🎰 รายการของรางวัลในตู้:**\n";
        const totalWeight = dbData.config.rewards.reduce((sum, item) => sum + item.chance, 0);
        dbData.config.rewards.forEach((item, index) => {
            const percent = ((item.chance / totalWeight) * 100).toFixed(1);
            msg += `> \`${index + 1}.\` **${item.name}** (${percent}%)\n`;
        });
        msg += `\n💎 **ค่ากด:** ${dbData.config.cost} P`;
        return interaction.reply(msg);
    }

    if (interaction.commandName === 'history') {
        if (dbData.history.length === 0) return interaction.reply("ยังไม่มีประวัติการหมุนครับ");
        const last10 = dbData.history.slice(-10).reverse();
        let msg = "**📜 ประวัติการหมุนล่าสุด (Last 10):**\n";
        last10.forEach(log => {
            msg += `• <t:${Math.floor(new Date(log.date).getTime()/1000)}:R> | **${log.user}** ➔ **${log.item}**\n`;
        });
        return interaction.reply(msg);
    }

    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '⛔ เฉพาะแอดมินเท่านั้นครับ', ephemeral: true });
    }

    if (interaction.commandName === 'random') {
        const cost = interaction.options.getInteger('cost');
        dbData.config.cost = cost; 
        saveDatabase();
        await interaction.reply(`✅ ตั้งค่าราคาหมุนเป็น **${cost} Points** เรียบร้อย`);
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
                await interaction.editReply(`✅ เพิ่ม **${amount} P** ให้ ${targetUser}. (รวม: ${newPoints} P)`);
            } catch (nickError) {
                await interaction.editReply(`✅ เพิ่มแต้มในระบบแล้ว (${newPoints} P) แต่ **แก้ชื่อไม่ได้** (ติดยศ/เจ้าของ)`);
            }
        } catch (error) {
            console.error(error);
            await interaction.editReply('หา User ไม่เจอครับ');
        }
    }

    else if (interaction.commandName === 'setreward') {
        const name = interaction.options.getString('name');
        const chance = interaction.options.getInteger('chance');
        const index = dbData.config.rewards.findIndex(r => r.name === name);
        
        if (index > -1) {
            dbData.config.rewards[index].chance = chance;
            await interaction.reply(`✅ อัปเดตโอกาสของ **${name}** เป็น ${chance}`);
        } else {
            dbData.config.rewards.push({ name, chance });
            await interaction.reply(`✅ เพิ่มของรางวัล **${name}** (โอกาส: ${chance})`);
        }
        saveDatabase(); 
    }

    else if (interaction.commandName === 'deletereward') {
        const name = interaction.options.getString('name');
        const initialLength = dbData.config.rewards.length;
        dbData.config.rewards = dbData.config.rewards.filter(r => r.name !== name);
        
        if (dbData.config.rewards.length < initialLength) {
            saveDatabase();
            await interaction.reply(`🗑️ ลบ **${name}** ออกแล้ว`);
        } else {
            await interaction.reply(`❌ หาของชื่อ **${name}** ไม่เจอ`);
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

const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
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
            return res.json({ success: false, msg: `พอยต์ไม่พอ! (ต้องการ ${COST} P)` });
        }

        const newPoints = currentPoints - COST;
        const newNickname = generateNewNickname(currentName, newPoints);

        try {
            await member.setNickname(newNickname);
        } catch (nickError) {
            console.error("Nickname failed:", nickError.message);
            return res.json({ success: false, msg: "บอทแก้ชื่อไม่ได้ (ยศต่ำกว่า หรือเป็นเจ้าของห้อง)" });
        }

        const rewardPool = dbData.config.rewards;
        let totalWeight = rewardPool.reduce((sum, item) => sum + item.chance, 0);
        let randomNum = Math.random() * totalWeight;
        let reward = "Error";

        for (const item of rewardPool) {
            if (randomNum < item.chance) {
                reward = item.name;
                break;
            }
            randomNum -= item.chance;
        }

        dbData.history.push({
            user: req.user.username,
            userId: userId,
            item: reward,
            cost: COST,
            date: new Date().toISOString()
        });
        saveDatabase();

        if (process.env.LOG_CHANNEL_ID) {
            try {
                const logChannel = await client.channels.fetch(process.env.LOG_CHANNEL_ID);
                if (logChannel) {
                    const avatarUrl = req.user.avatar 
                        ? `https://cdn.discordapp.com/avatars/${userId}/${req.user.avatar}.png` 
                        : 'https://cdn.discordapp.com/embed/avatars/0.png';

                    const logEmbed = new EmbedBuilder()
                        .setColor(0xFF9EB5)
                        .setAuthor({ name: `${req.user.username} เสี่ยงดวง!`, iconURL: avatarUrl })
                        .setTitle('🎉 ได้รับของรางวัล!')
                        .setDescription(`> **${reward}**`) 
                        .addFields(
                            { name: '💎 รางวัล (Reward)', value: `# 🎁 ${reward}`, inline: false },
                            { name: '👤 ผู้เล่น', value: `<@${userId}>`, inline: true },
                            { name: '💰 คงเหลือ', value: `\`${newPoints} P\``, inline: true }
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

        console.log(`[Spin] Result: ${reward}`);
        res.json({ success: true, item: reward, points: newPoints });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, msg: "Server Error" });
    }
});

server.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});
