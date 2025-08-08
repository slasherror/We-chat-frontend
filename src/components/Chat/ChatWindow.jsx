import AOS from "aos";
import "aos/dist/aos.css";
import { useEffect, useRef, useState } from "react";
import { ReactMic } from "react-mic";
import Modal from "react-modal";
import transcriptionIcon from "../../assets/transcription.png";
import { useAuthStore } from "../../store/authStore";
import { useChatStore } from "../../store/chatStore";
import axiosInstance from "../../utils/axiosInstance";
import { decryptAudio, decryptText, encryptAudio, encryptText } from "../../utils/crypto";

import toast from "react-hot-toast";
const customStyles = {
    content: {
        top: '50%',
        left: '50%',
        right: 'auto',
        bottom: 'auto',
        marginRight: '-50%',
        transform: 'translate(-50%, -50%)',
    },
};

const transcriptionStyles = {
    marginBottom: '8px',
    fontSize: '0.8em',
    padding: '8px',
    backgroundColor: '#f5f5f5',
    borderRadius: '4px',
    color: '#333',
    maxWidth: '550px',
};

Modal.setAppElement('#root');

const ChatWindow = () => {
    const { currentChat, messages, fethChats, addMessage, clearMessages, deleteMessage } = useChatStore();
    const [reactionError, setReactionError] = useState("");
    const [messageReactions, setMessageReactions] = useState({}); // { [messageId]: reaction }
    const [newMessage, setNewMessage] = useState("");
    const [isRecording, setIsRecording] = useState(false);
    const [audioBlob, setAudioBlob] = useState(null);
    const [isTyping, setIsTyping] = useState(false); // Local user typing status
    const [otherUserTyping, setOtherUserTyping] = useState(""); // Other user's typing status
    const typingTimeoutRef = useRef(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [transcription, setTranscription] = useState({});
    const [isTranscribing, setIsTranscribing] = useState({});

    const socketRef = useRef(null);
    const { accessToken } = useAuthStore()

        const reactionIcons = ["👍", "❤️", "😂", "😮", "😢", "👎"]; // static reactions

        // Send reaction via WebSocket (toggle: remove if same reaction)
        const handleReaction = (messageId, reaction) => {
            if (socketRef.current && socketRef.current.readyState === 1) {
                // If the current reaction is the same, remove it
                const current = messageReactions[messageId];
                socketRef.current.send(JSON.stringify({
                    type: "reaction",
                    message_id: messageId,
                    reaction: current === reaction ? null : reaction
                }));
            }
        };
    // websocket
    useEffect(() => {

        if (currentChat) {
            clearMessages();

            // Fetch chat history (ciphertext) and decrypt on client
            axiosInstance.get(`/chat/${currentChat.chat_id}/messages/`).then(async (response) => {
                const reactions = {};
                for (const message of response.data) {
                    if (message.reaction) {
                        reactions[message.id] = message.reaction;
                    }
                    if (message.encrypted_audio && message.encrypted_aes_key) {
                        try {
                            // IV is static and hardcoded in crypto.js
                            const u8 = decryptAudio(currentChat.private_key, message.encrypted_audio, message.encrypted_aes_key);
                            const blob = new Blob([u8], { type: 'audio/webm' });
                            const audioUrl = URL.createObjectURL(blob);
                            addMessage({ id: message.id, voice_url: audioUrl, sender: message.sender, text: "" });
                        } catch (e) {
                            console.error('Voice decrypt error', e);
                        }
                    } else if (message.text) {
                        try {
                            const plaintext = decryptText(currentChat.private_key, message.text);
                            addMessage({ ...message, text: plaintext });
                        } catch (e) {
                            console.error('Text decrypt error', e);
                        }
                    }
                }
                setMessageReactions(reactions);
            });

            // Initialize WebSocket
            socketRef.current = new WebSocket(`ws://127.0.0.1:8000/ws/chat/${currentChat.chat_id}/?token=${accessToken}`);

            socketRef.current.onmessage = async (event) => {
                const data = JSON.parse(event.data);

                if (data.type === "message") {
                    try {
                        const plaintext = decryptText(currentChat.private_key, data.text);
                        addMessage({ id: data.id, text: plaintext, sender: data.sender });
                    } catch (e) {
                        console.error('WS text decrypt error', e);
                    }
                } else if (data.type === "typing") {
                    if (data.sender !== currentChat.current_user) {
                        setOtherUserTyping(data.is_typing ? `${data.sender} is typing...` : "");
                    }
                }
                else if (data.type === "voice_message") {
                    try {
                        // IV is static and hardcoded in crypto.js
                        const u8 = decryptAudio(currentChat.private_key, data.encrypted_audio, data.encrypted_aes_key);
                        const blob = new Blob([u8], { type: 'audio/webm' });
                        const audioUrl = URL.createObjectURL(blob);
                        addMessage({ id: data.id, voice_url: audioUrl, sender: data.sender, text: "" });
                    } catch (e) {
                        console.error('WS voice decrypt error', e);
                    }
                }
                else if (data.type === "delete") {
                    deleteMessage(data.id);
                    if (data.sender === currentChat.current_user_id) {
                        toast.success("Message deleted successfully");
                    }
                    else {
                        toast.error("Unsent a message");
                    }
                }
                else if (data.type === "reaction") {
                    setMessageReactions(prev => ({
                        ...prev,
                        [data.message_id]: data.reaction
                    }));
                }
            };

            return () => {
                socketRef.current.close();
            };
        }
    }, [currentChat, clearMessages]);


    const startRecording = async () => {

        // Clear previous recording
        setAudioBlob(null);
        // if recording permission is granted start recording else ask for permission and if accepted start recording
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            console.log('Microphone access granted:', stream);
            setIsRecording(true);
        } catch (err) {
            console.error('Microphone access denied:', err);
            // setError('Microphone access denied. Please enable it in your browser settings.');
        }
        // setIsRecording(true);


    };


    const stopRecording = () => {

        setIsRecording(false);
    };

    const onData = (recordedBlob) => {
        // console.log('Recording data:', recordedBlob);
    };

    const onStop = (recordedBlob) => {
        console.log('Recording stopped: ', recordedBlob);
        console.log('Recording stopped: ', recordedBlob.blob);
        setAudioBlob(recordedBlob);
    };

    const handleModalClose = () => {
        setIsModalOpen(false);
        setIsRecording(false);
        // setAudioBlob(null);
    };

    const [showMenu, setShowMenu] = useState(false);  // To handle which message's menu is shown
    const audioRef = useRef(null);

    const toggleMenu = (index) => {
        // Toggle visibility of the dropdown menu
        setShowMenu(showMenu === index ? null : index);
    };

    const speakText = async (text) => {
        try {
            const res = await axiosInstance.post('/chat/tts/', { text });
            const { audio, mime } = res.data;
            const byteArray = Uint8Array.from(atob(audio), c => c.charCodeAt(0));
            const blob = new Blob([byteArray], { type: mime || 'audio/mpeg' });
            const url = URL.createObjectURL(blob);
            const el = new Audio(url);
            el.play();
        } catch (e) {
            console.error('TTS error', e);
            toast.error('Failed to generate voice');
        }
    };


    const sendVoiceMessage = () => {
        if (!audioBlob?.blob) return;
        const reader = new FileReader();
        reader.readAsArrayBuffer(audioBlob.blob);
        reader.onloadend = () => {
            const bytes = new Uint8Array(reader.result);
            const enc = encryptAudio(currentChat.public_key, bytes);
            // Do NOT send IV, since it's static and hardcoded
            socketRef.current.send(JSON.stringify({
                type: "voice",
                encrypted_audio: enc.encrypted_audio,
                encrypted_aes_key: enc.encrypted_aes_key,
                sender: currentChat.current_user_id,
                recipient: currentChat.participants[1]
            }));
        };
        setIsModalOpen(false);
    };




    const handleTyping = () => {
        if (!isTyping) {
            setIsTyping(true);
            socketRef.current.send(JSON.stringify({ type: "typing", is_typing: true }));
        }

        // Reset typing status after a delay
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
            setIsTyping(false);
            socketRef.current.send(JSON.stringify({ type: "typing", is_typing: false }));
        }, 2000);
    };

    const sendMessage = () => {

        if (socketRef.current && newMessage.trim()) {
            const ciphertext = encryptText(currentChat.public_key, newMessage);
            const messageData = { type: "message", message: ciphertext, voice_message: null, recipient: currentChat.participants[1] };
            socketRef.current.send(JSON.stringify(messageData));
            setNewMessage("");

            // scroll to bottom
            const chatWindow = document.querySelector(".ChatWindow");
            if (chatWindow) {
                chatWindow.scrollTop = chatWindow.scrollHeight;
            }


        }
    };

    const handleDeleteMessage = (messageId) => {

        if (socketRef.current) {
            socketRef.current.send(JSON.stringify({ type: "delete", message_id: messageId, sender: currentChat.current_user_id }));
            console.log(messageId);
            setShowMenu(null);  // Close the menu after deleting the message
        }
    };

    const handleAutoReply = async () => {
        try {
            // Check if there are messages to process
            if (messages.length === 0) {
                toast.error("No messages available for auto reply");
                return;
            }

            // Get the last 5 messages from the current chat
            const lastMessages = messages.slice(-5);
            
            // Process messages to include both text and audio
            const processedMessages = [];
            
            for (const msg of lastMessages) {
                if (msg.text && msg.text.trim() !== "") {
                    // Text message
                    processedMessages.push({
                        text: msg.text,
                        sender: msg.sender,
                        timestamp: msg.timestamp,
                        type: 'text'
                    });
                } else if (msg.voice_url) {
                    // Audio message - transcribe it
                    try {
                        const response = await fetch(msg.voice_url);
                        const audioBlob = await response.blob();
                        
                        const reader = new FileReader();
                        reader.readAsDataURL(audioBlob);
                        
                        const transcribedText = await new Promise((resolve, reject) => {
                            reader.onloadend = async () => {
                                try {
                                    const base64Audio = reader.result.split(',')[1];
                                    const result = await axiosInstance.post('/chat/transcribe/', {
                                        audio: base64Audio
                                    });
                                    resolve(result.data.transcription);
                                } catch (error) {
                                    reject(error);
                                }
                            };
                        });
                        
                        processedMessages.push({
                            text: transcribedText,
                            sender: msg.sender,
                            timestamp: msg.timestamp,
                            type: 'audio_transcribed'
                        });
                    } catch (error) {
                        console.error('Failed to transcribe audio message:', error);
                        // Skip this audio message if transcription fails
                    }
                }
            }

            if (processedMessages.length === 0) {
                toast.error("No text or transcribable audio messages available for auto reply");
                return;
            }

            toast.loading("Generating auto reply...");

            // Send to backend for GPT processing
            const response = await axiosInstance.post('/chat/auto-reply/', {
                messages: processedMessages,
                chat_id: currentChat.chat_id,
                recipient: currentChat.participants[1]
            });

            toast.dismiss();

            if (response.data.success) {
                // Fill the generated reply into the message input box
                setNewMessage(response.data.reply_text);
                toast.success("Auto reply generated and sent!");
                
                // Automatically send the message after a short delay
                setTimeout(() => {
                    sendMessage();
                }, 500);
            } else {
                toast.error("Failed to generate auto reply");
            }
        } catch (error) {
            toast.dismiss();
            console.error('Auto reply error:', error);
            toast.error('Failed to generate auto reply');
        }
    };

    const handleTranscribe = async (messageId, audioUrl) => {
        // If transcription already exists, remove it (toggle off)
        if (transcription[messageId]) {
            setTranscription(prev => {
                const newTranscription = { ...prev };
                delete newTranscription[messageId];
                return newTranscription;
            });
            return;
        }

        try {
            setIsTranscribing(prev => ({ ...prev, [messageId]: true }));

            // Fetch the audio file
            const response = await fetch(audioUrl);
            const audioBlob = await response.blob();

            // Convert to base64
            const reader = new FileReader();
            reader.readAsDataURL(audioBlob);
            reader.onloadend = async () => {
                const base64Audio = reader.result.split(',')[1];

                // Send to backend for transcription
                const result = await axiosInstance.post('/chat/transcribe/', {
                    audio: base64Audio
                });

                setTranscription(prev => ({
                    ...prev,
                    [messageId]: result.data.transcription
                }));
                setIsTranscribing(prev => ({ ...prev, [messageId]: false }));
            };
        } catch (error) {
            console.error('Transcription error:', error);
            toast.error('Failed to transcribe audio');
            setIsTranscribing(prev => ({ ...prev, [messageId]: false }));
        }
    };

    const toggleTranscription = (messageId, audioUrl) => {
        handleTranscribe(messageId, audioUrl);
    };

    // if messages are loaded, scroll to bottom
    useEffect(() => {
        const chatWindow = document.querySelector(".ChatWindow");
        if (chatWindow) {
            chatWindow.scrollTop = chatWindow.scrollHeight
        }
    }, [messages]);

    const handleKeyUp = (e) => {
        if (e.key === "Enter") {
            sendMessage();
        }
    };

    useEffect(() => {
        AOS.init();
        AOS.refresh();
    }, [])

    return (
        <div className=" bg-teal-50 h-full px-4 pt-2 mb-2 relative">
            {reactionError && (
                <div className="absolute top-4 right-10 z-50 flex items-center bg-white shadow-lg rounded-lg px-4 py-2 border border-red-300" style={{ minWidth: 220 }}>
                    <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="red" className="mr-2">
                        <circle cx="12" cy="12" r="10" fill="#fff" stroke="red" strokeWidth="2" />
                        <line x1="8" y1="8" x2="16" y2="16" stroke="red" strokeWidth="2" />
                        <line x1="16" y1="8" x2="8" y2="16" stroke="red" strokeWidth="2" />
                    </svg>
                    <span className="text-red-600 font-semibold">{reactionError}</span>
                </div>
            )}
            {currentChat ? (
                <div className="flex flex-col h-full ">
                    <div className="flex flex-col overflow-y-auto h-[85%] pb-5 ChatWindow px-4">
                        {messages.map((msg, index) => {
                            if (msg.text) {
                                return (
                                    <div key={index} className={`flex flex-col ${msg.sender === currentChat.current_user_id ? 'items-end' : 'items-start'} mb-2`}>
                                        {/* Show reaction below message if set */}
                                        {messageReactions[msg.id] && (
                                            <div className="flex items-center mb-1">
                                                <span className="text-2xl select-none" title="Reaction">{messageReactions[msg.id]}</span>
                                            </div>
                                        )}
                                        <div className={`flex items-center gap-x-2 relative ${msg.sender === currentChat.current_user_id ? '' : 'flex-row-reverse'}`}>
                                            {/* For left-side messages, : icon on left; for right-side, on right */}
                                            {msg.sender === currentChat.current_user_id ? (
                                                <>
                                                    <div
                                                        className={`p-2 w-fit max-w-[550px] bg-purple-700 text-white ms-auto rounded-l-xl rounded-tr-xl cursor-pointer`}
                                                    >
                                                        <p>{msg.text} </p>
                                                    </div>
                                                    <svg onClick={() => toggleMenu(index)} width="16px" height="16px" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="#000000" className="bi bi-three-dots-vertical cursor-pointer">
                                                        <path d="M9.5 13a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z" />
                                                    </svg>
                                                </>
                                            ) : (
                                                <>
                                                    <svg onClick={() => toggleMenu(index)} width="16px" height="16px" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="#000000" className="bi bi-three-dots-vertical cursor-pointer">
                                                        <path d="M9.5 13a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z" />
                                                    </svg>
                                                    <div
                                                        className={`p-2 w-fit max-w-[550px] bg-blue-500 text-white rounded-r-xl rounded-tl-xl cursor-pointer`}
                                                    >
                                                        <p>{msg.text} </p>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                        {/* Dropdown menu below text message, creates space and does not overlap */}
                                        {showMenu === index && (
                                            msg.sender === currentChat.current_user_id ? (
                                                <div className="w-full flex justify-end">
                                                    <div className="bg-white shadow-md rounded-lg p-2 mt-2 w-fit">
                                                        <button
                                                            onClick={() => handleDeleteMessage(msg.id)}
                                                            className="text-red-500"
                                                        >
                                                            Delete
                                                        </button>
                                                        <button
                                                            onClick={() => speakText(msg.text)}
                                                            className="text-blue-500 ml-3"
                                                        >
                                                            Voice
                                                        </button>
                                                        <div className="flex gap-2 mt-2">
                                                            {reactionIcons.map((icon) => (
                                                                <button key={icon} className="text-xl" onClick={() => handleReaction(msg.id, icon)}>
                                                                    {icon}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="w-full flex">
                                                    <div className="bg-white shadow-md rounded-lg p-2 mt-2 w-fit">
                                                        <button
                                                            onClick={() => speakText(msg.text)}
                                                            className="text-blue-500"
                                                        >
                                                            Voice
                                                        </button>
                                                        <div className="flex gap-2">
                                                            {reactionIcons.map((icon) => (
                                                                <button key={icon} className="text-xl" onClick={() => handleReaction(msg.id, icon)}>
                                                                    {icon}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                            )
                                        )}
                                    </div>
                                );

                            }
                            else if (msg.voice_url) {
                                return (
                                    <div key={index} className={`flex flex-col peer gap-x-2 ${msg.sender === currentChat.current_user_id && 'ms-auto'} `}>
                                        <div className={`w-fit max-w-[550px] flex items-center ${msg.sender === currentChat.current_user_id ? " text-white ms-auto rounded-l-lg rounded-tr-lg" : " text-white rounded-r-lg rounded-tl-lg"} mb-2`}>
                                            <div className={`flex items-center peer gap-x-2 ${msg.sender === currentChat.current_user_id && 'ms-auto'} `}>
                                                {/* Transcription Icon - Available for all voice messages */}
                                                <img src={transcriptionIcon}
                                                    onClick={() => toggleTranscription(msg.id, msg.voice_url)}
                                                    width="16px"
                                                    height="16px"
                                                    className="hover:scale-110 transition-transform w-4 h-4 cursor-pointer"
                                                    title={isTranscribing[msg.id] ? 'Transcribing...' : transcription[msg.id] ? 'Hide Transcription' : 'Show Transcription'}
                                                    alt="transcription" />
                                                {msg.sender === currentChat.current_user_id && (
                                                    <div className="flex items-center">
                                                        <svg onClick={() => toggleMenu(index)} width="16px" height="16px" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="#000000" className="bi bi-three-dots-vertical cursor-pointer">
                                                            <path d="M9.5 13a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z" />
                                                        </svg>
                                                    </div>
                                                )}
                                                {msg.sender !== currentChat.current_user_id && (
                                                    <div className="flex items-center">
                                                        <svg onClick={() => toggleMenu(index)} width="16px" height="16px" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="#000000" className="bi bi-three-dots-vertical cursor-pointer">
                                                            <path d="M9.5 13a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z" />
                                                        </svg>
                                                    </div>
                                                )}
                                            </div>
                                            <audio controls>
                                                <source src={msg.voice_url} type="audio/webm" />
                                                Your browser does not support the audio element.
                                            </audio>
                                        </div>
                                        {/* Dropdown menu below audio message, creates space and does not overlap */}
                                        {showMenu === index && (
                                            <div className="w-full flex">
                                                <div className="bg-white shadow-md rounded-lg p-2 mt-2 w-fit">
                                                    {msg.sender === currentChat.current_user_id ? (
                                                        <>
                                                            <button
                                                                onClick={() => handleDeleteMessage(msg.id)}
                                                                className="text-red-500"
                                                            >
                                                                Delete
                                                            </button>
                                                            <div className="flex gap-2 mt-2">
                                                                {reactionIcons.map((icon) => (
                                                                    <button key={icon} className="text-xl" onClick={() => handleReaction(msg.id, icon)}>
                                                                        {icon}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <div className="flex gap-2">
                                                                {reactionIcons.map((icon) => (
                                                                    <button key={icon} className="text-xl" onClick={() => handleReaction(msg.id, icon)}>
                                                                        {icon}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                        {/* Show transcription if available */}
                                        {transcription[msg.id] && (
                                            <div style={transcriptionStyles} className={`w-fit ${msg.sender === currentChat.current_user_id ? "ms-auto" : ""}`}>
                                                {transcription[msg.id]}
                                            </div>
                                        )}
                                    </div>
                                );
                            }


                        })}


                        {otherUserTyping && (
                            <div className="text-sm text-gray-500">{otherUserTyping}</div>
                        )}
                    </div>


                    {/* input message box */}

                    <div className="flex w-full p-0 h-auto px-5 ">
                        <input
                            type="text"
                            value={newMessage}
                            onKeyDown={handleTyping}
                            onKeyUp={handleKeyUp}
                            onChange={(e) => setNewMessage(e.target.value)}
                            className="flex-1 p-3 border rounded-md"
                        />
                        <button
                            onClick={sendMessage}
                            className="bg-blue-500 text-white py-1 px-4 rounded-md ml-2"
                        >
                            Send
                        </button>
                        <button onClick={() => setIsModalOpen(true)} className="bg-green-500 text-white py-1 px-4 rounded-md ml-2">
                            Record
                        </button>
                        <button onClick={handleAutoReply} className="bg-yellow-500 text-white py-1 px-4 rounded-md ml-2">
                            Auto Reply
                        </button>
                    </div>

                    {/* modal for voice recording */}
                    <Modal style={customStyles} isOpen={isModalOpen} onRequestClose={handleModalClose}>
                        <h2>Record Voice Message</h2>
                        <ReactMic
                            record={isRecording}
                            className="frequencyBars my-4"
                            visualSetting="frequencyBars"
                            onStop={onStop}
                            onData={onData}
                            mimeType="audio/webm"
                            strokeColor="#ffd900"
                            backgroundColor="#3b72e9"
                            noiseSuppression={true}

                        />
                        <button onClick={startRecording} disabled={isRecording} className="bg-blue-500 text-white py-1 px-4 rounded-md">
                            {isRecording ? "Recording..." : "Start Recording"}
                        </button>
                        <button onClick={stopRecording} disabled={!isRecording} className="bg-red-500 text-white py-1 px-4 rounded-md ml-2">
                            Stop
                        </button>
                        <button
                            onClick={sendVoiceMessage}
                            disabled={!audioBlob}
                            className="bg-green-500 text-white py-1 px-4 rounded-md ml-2"
                        >
                            Send Voice Message
                        </button>
                    </Modal>
                </div>
            ) : (
                <p className="text-center text-gray-500">Select a chat to start messaging.</p>
            )}


        </div>
    );
}


export default ChatWindow;