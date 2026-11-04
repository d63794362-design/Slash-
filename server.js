require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json());

// Подключение к Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Настройка почты для отправки кодов активации мессенджера Слэш
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Временное хранилище кодов верификации почты в оперативной памяти
const verificationCodes = new Map();

// Список подарков "как в Telegram" с реальной ценой в звездах
const TELEGRAM_GIFTS = {
    "Red Star": 500,
    "Blue Star": 1000,
    "Gold Star": 2500,
    "Diamond": 5000,
    "Cake": 250,
    "Heart": 100
};

// ==========================================
// 1. РЕГИСТРАЦИЯ И АВТОРИЗАЦИЯ В СЛЭШ
// ==========================================

// Шаг 1: Отправка реального кода на почту с проверкой дубликатов
app.post('/auth/send-code', async (req, res) => {
    const { email, username } = req.body;

    if (!email || !username) {
        return res.status(400).json({ error: "Email и Username обязательны!" });
    }

    const { data: existingUser } = await supabase
        .from('users')
        .select('id, email, username')
        .or(`email.eq.${email},username.eq.${username}`);

    if (existingUser && existingUser.length > 0) {
        return res.status(400).json({ error: "Этот Email или Username уже зарегистрированы в Слэш!" });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    verificationCodes.set(email, { code, username, expires: Date.now() + 600000 });

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Код подтверждения регистрации в мессенджере Слэш',
        text: `Ваш персональный код активации в мессенджере Слэш: ${code}`
    };

    transporter.sendMail(mailOptions, (err) => {
        if (err) return res.status(500).json({ error: "Не удалось отправить письмо с кодом", details: err });
        res.json({ message: "Код успешно отправлен на вашу почту!" });
    });
});

// Шаг 2: Проверка кода и создание профиля
app.post('/auth/register', async (req, res) => {
    const { email, code } = req.body;
    const record = verificationCodes.get(email);

    if (!record || record.code !== code || record.expires < Date.now()) {
        return res.status(400).json({ error: "Неверный, использованный или просроченный код!" });
    }

    const { data, error } = await supabase
        .from('users')
        .insert([{ username: record.username, email: email, stars_balance: 1000 }])
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });

    verificationCodes.delete(email);
    res.json({ message: "Регистрация в Слэш завершена успешно!", user: data });
});

// Чекер для проверки существования данных на лету
app.post('/utils/check-exists', async (req, res) => {
    const { field, value } = req.body;
    if (!['email', 'username', 'phone'].includes(field)) {
        return res.status(400).json({ error: "Недопустимое поле для проверки" });
    }
    const { data } = await supabase.from('users').select('id').eq(field, value).maybeSingle();
    res.json({ exists: !!data });
});

// ==========================================
// 2. ОБЩЕНИЕ, ПОИСК И УДАЛЯЕМЫЙ ИИ
// ==========================================

app.get('/users/search', async (req, res) => {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: "Введите username для поиска" });

    const { data, error } = await supabase
        .from('users')
        .select('id, username, phone, is_premium')
        .ilike('username', `%${username}%`)
        .limit(20);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ users: data });
});

app.post('/messages/send', async (req, res) => {
    const { sender_id, receiver_id, text, is_to_ai } = req.body;

    if (!text || text.trim() === "") return res.status(400).json({ error: "Текст сообщения не может быть пустым" });

    if (is_to_ai) {
        const { data: user } = await supabase.from('users').select('ai_enabled').eq('id', sender_id).single();
        if (user && !user.ai_enabled) {
            return res.status(400).json({ error: "Вы удалили ИИ-ассистента!" });
        }

        await supabase.from('messages').insert([{ sender_id, receiver_id: 0, text_content: text }]);

        const aiResponses = [
            "Привет! Я встроенный ИИ мессенджера Слэш. Чем могу помочь?",
            "Отличный вопрос! Попробуй накопить больше звезд через нашего бота.",
            "Я работаю прямо внутри Слэш! Меня можно удалить в настройках профиля.",
            "Звёзды на твоем аккаунте можно потратить на Слэш Premium или покупку уникального номера +888!"
        ];
        const randomAnswer = aiResponses[Math.floor(Math.random() * aiResponses.length)];

        const { data: aiMessage } = await supabase
            .from('messages')
            .insert([{ sender_id: 0, receiver_id: sender_id, text_content: randomAnswer }])
            .select()
            .single();

        return res.json({ message: "Ответ от ИИ получен", data: aiMessage });
    }

    const { data, error } = await supabase
        .from('messages')
        .insert([{ sender_id, receiver_id, text_content: text }])
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: "Сообщение доставлено", data });
});

app.post('/users/toggle-ai', async (req, res) => {
    const { user_id, enable_ai } = req.body;

    const { data, error } = await supabase
        .from('users')
        .update({ ai_enabled: enable_ai })
        .eq('id', user_id)
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: enable_ai ? "ИИ успешно добавлен обратно!" : "ИИ успешно удален из мессенджера!", user: data });
});

app.get('/messages/history', async (req, res) => {
    const { user_id, chat_with_id } = req.query;
    if (!user_id || !chat_with_id) return res.status(400).json({ error: "Необходимы оба ID участников чата" });

    const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or(`and(sender_id.eq.${user_id},receiver_id.eq.${chat_with_id}),and(sender_id.eq.${chat_with_id},receiver_id.eq.${user_id})`)
        .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ chat_history: data });
});

// ==========================================
// 3. БОТ СЛЭШ: НАКРУТКА ЗВЕЗД, ПОКУПКА НОМЕРОВ И ЮЗЕРНЕЙМОВ
// ==========================================

app.post('/bot/buy-stars', async (req, res) => {
    const { user_id, amount } = req.body;
    const { data: user } = await supabase.from('users').select('stars_balance').eq('id', user_id).single();
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });
    
    const { data: updatedUser, error } = await supabase
        .from('users')
        .update({ stars_balance: user.stars_balance + parseInt(amount) })
        .eq('id', user_id)
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: `Успешно начислено ${amount} звезд!`, balance: updatedUser.stars_balance });
});

app.post('/bot/buy-number', async (req, res) => {
    const { user_id } = req.body;
    const NUMBER_PRICE = 999;

    const { data: user } = await supabase.from('users').select('stars_balance').eq('id', user_id).single();
    if (!user || user.stars_balance < NUMBER_PRICE) {
        return res.status(400).json({ error: "Недостаточно звезд!" });
    }

    let isUnique = false;
    let generatedNumber = '';

    while (!isUnique) {
        const randomDigits = Math.floor(10000000 + Math.random() * 90000000).toString();
        generatedNumber = `+888${randomDigits}`;
        const { data } = await supabase.from('purchased_numbers').select('id').eq('phone_number', generatedNumber).maybeSingle();
        if (!data) isUnique = true;
    }

    await supabase.from('users').update({ stars_balance: user.stars_balance - NUMBER_PRICE, phone: generatedNumber }).eq('id', user_id);
    await supabase.from('purchased_numbers').insert([{ phone_number: generatedNumber, owner_id: user_id }]);

    res.json({ message: "Вы успешно купили анонимный номер +888 в Слэш!", phone: generatedNumber });
});

app.post('/bot/buy-username', async (req, res) => {
    const { user_id, desired_username } = req.body;
    const USERNAME_PRICE = 1500;

    const usernameRegex = /^[a-zA-Z0-9_]{3,15}$/;
    if (!usernameRegex.test(desired_username)) {
        return res.status(400).json({ error: "Юзернейм должен быть от 3 до 15 символов!" });
    }

    const { data: userCheck } = await supabase.from('users').select('id').eq('username', desired_username).maybeSingle();
    const { data: reserveCheck } = await supabase.from('purchased_usernames').select('id').eq('username', desired_username).maybeSingle();

    if (userCheck || reserveCheck) {
        return res.status(400).json({ error: "Этот премиальный юзернейм уже занят!" });
    }

    const { data: user } = await supabase.from('users').select('stars_balance').eq('id', user_id).single();
    if (!user || user.stars_balance < USERNAME_PRICE) {
        return res.status(400).json({ error: "Недостаточно звезд!" });
    }

    await supabase.from('users').update({ stars_balance: user.stars_balance - USERNAME_PRICE, username: desired_username }).eq('id', user_id);
    await supabase.from('purchased_usernames').insert([{ username: desired_username, owner_id: user_id }]);
res.json({ message: Вы успешно приобрели премиум-юзернейм: @${desired_username}!, new_username: desired_username });
});
// ==========================================
// 4. ПОДАРКИ И ПОКУПКА СЛЭШ PREMIUM ЗА ЗВЕЗДЫ
// ==========================================
app.post('/gifts/send', async (req, res) => {
const { sender_id, receiver_id, gift_name } = req.body;
const price = TELEGRAM_GIFTS[gift_name];
if (!price) return res.status(400).json({ error: "Такого подарка не существует!" });
const { data: sender } = await supabase.from('users').select('stars_balance').eq('id', sender_id).single();
if (!sender || sender.stars_balance < price) {
return res.status(400).json({ error: "У вас недостаточно звезд!" });
}
await supabase.from('users').update({ stars_balance: sender.stars_balance - price }).eq('id', sender_id);
await supabase.from('user_gifts').insert([{ gift_name, price_stars: price, sender_id, receiver_id }]);
res.json({ message: Подарок "${gift_name}" успешно отправлен! });
});
app.post('/premium/buy', async (req, res) => {
const { user_id } = req.body;
const PREMIUM_PRICE = 500;
const { data: user } = await supabase.from('users').select('stars_balance, is_premium').eq('id', user_id).single();
if (!user) return res.status(404).json({ error: "Пользователь не найден" });
if (user.is_premium) return res.status(400).json({ error: "Слэш Premium статус уже активен!" });
if (user.stars_balance < PREMIUM_PRICE) return res.status(400).json({ error: "Недостаточно звезд!" });
const { data: updatedUser } = await supabase
.from('users')
.update({ stars_balance: user.stars_balance - PREMIUM_PRICE, is_premium: true })
.eq('id', user_id)
.select()
.single();
res.json({ message: "Слэш Premium статус успешно куплен за звезды!", user: updatedUser });
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(Бэкенд мессенджера Слэш успешно запущен на порту ${PORT}));
