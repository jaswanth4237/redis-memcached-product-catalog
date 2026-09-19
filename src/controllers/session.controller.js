const SessionModel = require('../models/session.model');

class SessionController {
    static async getSession(req, res) {
        try {
            const sessionId = req.params.id;
            const backend = req.cacheBackend;

            const session = await SessionModel.getSession(sessionId, backend);
            if (!session || Object.keys(session).length === 0) {
                return res.status(404).json({ error: 'Session not found' });
            }

            return res.json({ session_id: sessionId, session, _backend: backend });
        } catch (err) {
            console.error('Error getting session:', err);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    static async setSession(req, res) {
        try {
            const sessionId = req.params.id;
            const backend = req.cacheBackend;
            const sessionData = req.body;

            if (!sessionData || typeof sessionData !== 'object') {
                return res.status(400).json({ error: 'Session body must be an object' });
            }

            await SessionModel.setSession(sessionId, sessionData, backend);
            return res.json({ message: 'Session saved', session_id: sessionId, _backend: backend });
        } catch (err) {
            console.error('Error setting session:', err);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    static async updateSessionField(req, res) {
        try {
            const sessionId = req.params.id;
            const backend = req.cacheBackend;
            const { field, value } = req.body;

            if (!field) {
                return res.status(400).json({ error: 'Field name is required' });
            }

            await SessionModel.updateSessionField(sessionId, field, value, backend);
            return res.json({ message: 'Session field updated', session_id: sessionId, field, value, _backend: backend });
        } catch (err) {
            console.error('Error updating session field:', err);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    }
}

module.exports = SessionController;
