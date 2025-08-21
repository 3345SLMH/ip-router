export default {
    printLog: false,
    /** משפיע על ניקוי טקסטים עבור TTS וטקסטים ב־files */
    removeInvalidChars: false,

    /** ברירת מחדל למודולי קריאה / הקשה / הקלטה / STT לפי API החדש */
    read: {
        /** טיימאאוט כללי לקריאת מודול (בשניות, כפי שבתיעוד החדש) */
        timeout: 0,

        /** הקשות – תואם getDTMF */
        tap: {
            /** min/max ספרות */
            min: 1,
            max: '',
            /** זמן המתנה להקשה (שניות) */
            timeout: 7,
            /** confirmType: "number" | "digits" | "no" */
            confirmType: 'digits',
            /** skipKey / skipValue */
            skipKey: '',
            skipValue: '',
            /** הפעלת מוזיקה בהמתנה */
            setMusic: 'no',
            /** קבצים/טקסטים להשמעה לפני קבלת הקשה */
            files: []
        },

        /** STT – תואם stt */
        stt: {
            min: '',
            max: 10, // עד 10 שניות משפט לפי התיעוד
            fileName: '',
            saveFolder: '',  // extensionId
            campaignBilling: '', // מזהה לקמפיין
            files: []
        },

        /** הקלטה – תואם record */
        record: {
            min: 2,
            max: 10,
            /** confirm: "confirmOnly" | "ful" | "no" */
            confirm: 'confirmOnly',
            fileName: '',
            saveFolder: '', // extensionId
            files: []
        }
    },

    /** תפריט פשוט – תואם simpleMenu */
    simpleMenu: {
        name: 'menu',
        times: 1,
        timeout: 5,
        enabledKeys: '1,2,3,4,5,6,7,8,9,0,#,*',
        setMusic: 'no',
        errorReturn: 'ERROR',
        /** אפשר לעבור אוטומטית לאחר שסיים להשמיע times פעמים */
        extensionChange: '',
        files: []
    },

    /** הודעה מרובת פריטים (כעת ממופה ל־files של המודולים) */
    id_list_message: {
        removeInvalidChars: false
    }
};
