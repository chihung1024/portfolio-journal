const admin = require('firebase-admin');

const verifyFirebaseToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(403).send({ success: false, message: 'Unauthorized: Missing or invalid authorization token.'});
        return;
    }
    const idToken = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error('Token 驗證失敗:', error.message);
        res.status(403).send({ success: false, message: 'Unauthorized: Token verification failed. 請嘗試重新登入。'});
    }
};

module.exports = { verifyFirebaseToken };
