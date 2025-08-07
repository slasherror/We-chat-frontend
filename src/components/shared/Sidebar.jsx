import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import { useChatStore } from '../../store/chatStore';
import axiosInstance from '../../utils/axiosInstance';

const Sidebar = () => {
    const [searchTerm, setSearchTerm] = useState("");
    const [searchResults, setSearchResults] = useState([]);
    const [onlineUsers, setOnlineUsers] = useState({});
    const presenceSocket = useRef(null);

    const { chats, setChats, fetchChats, currentChat, setCurrentChat } = useChatStore();
    const { userData, accessToken } = useAuthStore();

    // ✅ Connect to presence WebSocket
    useEffect(() => {
        if (!userData?.id || !accessToken) {
            console.log("No user data or token available");
            return;
        }

        console.log("Connecting to presence WebSocket with user:", userData.id);
        console.log("Token available:", !!accessToken);
        const presenceChatId = 0; // Shared presence room
        const socketUrl = `ws://127.0.0.1:8000/ws/chat/${presenceChatId}/?token=${accessToken}`;
        presenceSocket.current = new WebSocket(socketUrl);

        presenceSocket.current.onopen = () => {
            console.log("✅ Presence socket connected to:", socketUrl);
        };

        // Add timeout to check if connection is established
        const connectionTimeout = setTimeout(() => {
            if (presenceSocket.current?.readyState !== WebSocket.OPEN) {
                console.error("WebSocket connection timeout - readyState:", presenceSocket.current?.readyState);
            }
        }, 5000);

        presenceSocket.current.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log("WebSocket message received:", data);

                // ✅ Received individual user status update
                if (data.type === "user-status") {
                    console.log("User status update:", data.userId, data.online);
                    setOnlineUsers(prev => {
                        const newState = {
                            ...prev,
                            [parseInt(data.userId)]: data.online
                        };
                        console.log("Updated online users state:", newState);
                        return newState;
                    });
                }

                // ✅ Received the initial full list of online users
                if (data.type === "initial-online-list") {
                    console.log("Initial online users:", data.user_ids);
                    const onlineMap = {};
                    for (const id of data.user_ids) {
                        onlineMap[parseInt(id)] = true;
                    }
                    console.log("Setting initial online map:", onlineMap);
                    setOnlineUsers(onlineMap);
                }
            } catch (err) {
                console.error("WebSocket message parse error:", err);
            }
        };

        presenceSocket.current.onerror = (err) => {
            console.error("WebSocket error:", err);
            console.error("WebSocket URL was:", socketUrl);
        };

        presenceSocket.current.onclose = () => {
            console.log("Presence WebSocket closed");
        };

        return () => {
            clearTimeout(connectionTimeout);
            presenceSocket.current?.close();
        };
    }, [userData?.id, accessToken]);


    // 🔍 Search users by email
    const searchUsers = async () => {
        if (!searchTerm) return;
        try {
            const response = await axiosInstance.get(`/chat/search_users/?email=${searchTerm}`);
            setSearchResults(response.data);
        } catch (error) {
            console.error("Error searching users:", error);
        }
    };

    // ➕ Start chat
    const startChat = async (userId) => {
        try {
            const response = await axiosInstance.post("/chat/start_chat/", { user_id: userId });
            const chat = response.data;
            setChats([...chats, chat]);
            setCurrentChat(chat);
            setSearchResults([]);
            setSearchTerm("");
        } catch (error) {
            console.error("Error starting chat:", error);
        }
    };

    useEffect(() => {
        fetchChats();
    }, []);

    // Debug chat data
    useEffect(() => {
        console.log("Chats data:", chats);
    }, [chats]);

    // Debug online users state changes
    useEffect(() => {
        console.log("Online users state changed:", onlineUsers);
    }, [onlineUsers]);

    return (
        <div className="w-1/5 bg-slate-200 shadow-lg flex flex-col">
            <div className="w-full bg-gray-100 p-4">
                <h2 className="text-lg font-semibold mb-4">Chats</h2>
                <div>
                    <input
                        type="text"
                        placeholder="Search by email"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full p-2 border rounded-md mb-2"
                    />
                    {searchResults.length > 0 && (
                        <div className="my-4">
                            <h3 className="text-sm font-semibold mb-2">Search Results:</h3>
                            <ul>
                                {searchResults.map((user) => (
                                    <li
                                        key={user.id}
                                        className="p-2 cursor-pointer hover:bg-gray-200 rounded-md"
                                        onClick={() => startChat(user.id)}
                                    >
                                        {user.email}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    <button
                        onClick={searchUsers}
                        className="w-full bg-blue-500 text-white py-1 rounded-md"
                    >
                        Search
                    </button>
                </div>
            </div>

            <ul className="mb-6 p-4">
                {chats?.length > 0 && chats.map((chat, index) => {
                    const otherUserId = parseInt(chat.other_user_id);
                    const isOnline = onlineUsers[otherUserId];
                    console.log("Chat data:", chat, "Online users:", onlineUsers, "Other user ID:", chat.other_user_id, "Parsed ID:", otherUserId, "Is online:", isOnline);
                    return (
                        <li
                            key={index}
                            className={`p-2 cursor-pointer rounded-md border-b border-b-gray-300 ${chat.chat_id === currentChat?.chat_id ? "bg-blue-500 text-white" : "hover:bg-slate-300"}`}
                            onClick={() => setCurrentChat(chat)}
                        >
                            <span className="flex items-center gap-2">
                                {/* ✅ Online/offline dot */}
                                <span
                                    className={`w-2 h-2 rounded-full ${
                                        isOnline ? "bg-red-500" : "bg-gray-400"
                                    }`}
                                ></span>
                                {chat?.other_user[0]}
                            </span>
                        </li>
                    );
                })}
            </ul>

            <div className="mt-auto p-4 bg-gray-100 border-t border-t-gray-300">
                <p className="text-sm mb-1">Username: {userData?.username}</p>
                <p className="text-sm mb-1">Email: {userData?.email}</p>
                <a href="/update-profile" className="text-blue-500 text-sm underline">
                    Update Profile
                </a>
            </div>
        </div>
    );
};

export default Sidebar;
