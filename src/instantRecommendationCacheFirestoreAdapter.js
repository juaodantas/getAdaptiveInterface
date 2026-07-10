const COLLECTION_NAME = 'instantRecommendationCache';

function createInstantRecommendationCacheFirestoreAdapter(db, admin) {
  const collection = () => db.collection(COLLECTION_NAME);
  const serverTimestamp = () => admin?.firestore?.FieldValue?.serverTimestamp?.() || new Date();
  const increment = (value) => admin?.firestore?.FieldValue?.increment?.(value) || value;

  return {
    async get(cacheKey) {
      try {
        const doc = await collection().doc(cacheKey).get();
        return { ok: true, entry: doc.exists ? doc.data() : null };
      } catch (error) {
        return { ok: false, error };
      }
    },

    async set(entry) {
      try {
        await collection().doc(entry.cacheKey).set({
          ...entry,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
        return { ok: true };
      } catch (error) {
        return { ok: false, error };
      }
    },

    async markHit(cacheKey) {
      try {
        await collection().doc(cacheKey).set({
          stats: {
            hitCount: increment(1),
            lastHitAt: serverTimestamp(),
          },
          updatedAt: serverTimestamp(),
        }, { merge: true });
        return { ok: true };
      } catch (error) {
        return { ok: false, error };
      }
    },
  };
}

module.exports = { COLLECTION_NAME, createInstantRecommendationCacheFirestoreAdapter };
